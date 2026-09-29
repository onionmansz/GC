-- Helpers, triggers and RPCs.
-- Error messages are short codes (e.g. 'insufficient_balance') and never include
-- card numbers, PINs or amounts; the client maps them to friendly text.

-- Membership check used by every RLS policy. SECURITY DEFINER so policies on
-- household_members itself don't recurse.
create function public.is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

-- household_id, created_by and created_at are immutable on cards.
create function public.cards_lock_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.household_id <> old.household_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger cards_lock_columns before update on public.cards
  for each row execute function public.cards_lock_columns();

-- After every ledger insert: serialise per card, forbid a negative balance,
-- and auto-archive at exactly $0 (unarchive when the balance is positive again).
-- Mirrors archivedAfterTransaction() in src/lib/ledger.ts.
create function public.transactions_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bal bigint;
begin
  perform 1 from public.cards where id = new.card_id for update;
  select coalesce(sum(amount_cents), 0) into bal
    from public.transactions where card_id = new.card_id;
  if bal < 0 then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;
  update public.cards set archived = (bal = 0)
   where id = new.card_id and archived is distinct from (bal = 0);
  return null;
end $$;

create trigger transactions_after_insert after insert on public.transactions
  for each row execute function public.transactions_after_insert();

-- First-run: create a household for the caller and seed the default merchants.
create function public.create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.household_members where user_id = uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.households (name) values (btrim(p_name)) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, uid, btrim(p_display_name));
  -- balance_check_url intentionally left null; the household fills these in.
  insert into public.merchants (household_id, name, category, color) values
    (hid, 'Indigo',      'Books',  '#1f2a44'),
    (hid, 'Esso',        'Gas',    '#d52b1e'),
    (hid, 'Tim Hortons', 'Coffee', '#c8102e');
  return hid;
end $$;

-- First-run for an invited member: join the household whose pending invite
-- matches the caller's verified email.
create function public.accept_household_invite(p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.household_invites;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.household_members where user_id = uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  select * into inv from public.household_invites
   where email = lower(auth.jwt() ->> 'email') and accepted_at is null
   for update;
  if not found then
    raise exception 'no_invite' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
    values (inv.household_id, uid,
            coalesce(nullif(btrim(p_display_name), ''), inv.display_name));
  update public.household_invites set accepted_at = now()
   where household_id = inv.household_id and email = inv.email;
  return inv.household_id;
end $$;

-- Create a card and its opening 'load' transaction atomically.
-- SECURITY INVOKER: all RLS policies still apply.
create function public.create_card(
  p_merchant_id           uuid,
  p_card_number           text,
  p_opening_balance_cents bigint,
  p_label                 text default null,
  p_pin                   text default null,
  p_barcode_format        text default null,
  p_barcode_value         text default null,
  p_barcode_image_path    text default null,
  p_held_by               uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  cid uuid;
  hid uuid;
begin
  if p_opening_balance_cents is null or p_opening_balance_cents < 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select household_id into hid from public.merchants where id = p_merchant_id;
  if hid is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  insert into public.cards (household_id, merchant_id, label, card_number, pin,
                            barcode_format, barcode_value, barcode_image_path,
                            held_by, balance_checked_at)
  values (hid, p_merchant_id, nullif(btrim(p_label), ''), btrim(p_card_number),
          nullif(p_pin, ''), p_barcode_format, p_barcode_value, p_barcode_image_path,
          p_held_by, now())
  returning id into cid;

  if p_opening_balance_cents > 0 then
    insert into public.transactions (card_id, type, amount_cents, note)
    values (cid, 'load', p_opening_balance_cents, 'Opening balance');
  else
    -- A card added at $0 starts archived, matching the auto-archive rule.
    update public.cards set archived = true where id = cid;
  end if;
  return cid;
end $$;

-- "Set balance to X": insert an 'adjust' transaction for the difference.
-- The card row lock makes concurrent edits by both members safe.
create function public.set_card_balance(
  p_card_id      uuid,
  p_target_cents bigint,
  p_note         text default null
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  cur   bigint;
  delta bigint;
begin
  if p_target_cents is null or p_target_cents < 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  perform 1 from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_cents), 0) into cur
    from public.transactions where card_id = p_card_id;
  delta := p_target_cents - cur;

  if delta <> 0 then
    insert into public.transactions (card_id, type, amount_cents, note)
    values (p_card_id, 'adjust', delta, nullif(btrim(p_note), ''));
  end if;
  update public.cards set balance_checked_at = now() where id = p_card_id;
  return delta;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_household_member(uuid),
  public.create_household(text, text),
  public.accept_household_invite(text),
  public.create_card(uuid, text, bigint, text, text, text, text, text, uuid),
  public.set_card_balance(uuid, bigint, text)
to authenticated;
