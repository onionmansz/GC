-- Assisted checks for any merchant: auto_check = 'assisted' opens the merchant's own
-- balance page (merchants.balance_check_url) in the worker, fills in the card and
-- hands it to a person for the "I'm not a robot" step, like 'sportchek'.

alter table public.merchants drop constraint merchants_auto_check_check;
alter table public.merchants
  add constraint merchants_auto_check_check check (auto_check in ('indigo', 'sportchek', 'assisted'));

create or replace function public.request_balance_check(p_card_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c   record;
  rid uuid;
begin
  select cards.id, cards.household_id, merchants.auto_check, merchants.balance_check_url into c
    from public.cards join public.merchants on merchants.id = cards.merchant_id
   where cards.id = p_card_id;
  if not found or not public.is_household_member(c.household_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if c.auto_check is null then
    raise exception 'not_supported' using errcode = 'P0001';
  end if;
  if c.auto_check = 'assisted' and c.balance_check_url is null then
    raise exception 'no_balance_page' using errcode = 'P0001';
  end if;

  select id into rid from public.balance_check_requests
   where card_id = p_card_id and status in ('pending', 'running', 'awaiting_user');
  if found then
    return rid;
  end if;

  insert into public.balance_check_requests (household_id, card_id, requested_by)
  values (c.household_id, p_card_id, auth.uid())
  returning id into rid;
  return rid;
exception when unique_violation then
  select id into rid from public.balance_check_requests
   where card_id = p_card_id and status in ('pending', 'running', 'awaiting_user');
  return rid;
end $$;

-- Now also returns the merchant's balance page (page_url) for assisted checks.
drop function public.claim_balance_check();
create function public.claim_balance_check()
returns table (request_id uuid, card_id uuid, provider text, card_number text, pin text, page_url text)
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  req public.balance_check_requests;
begin
  select m.household_id into hid from public.household_members m
   where m.user_id = auth.uid() and m.is_service;
  if hid is null then
    raise exception 'not_service_member' using errcode = 'P0001';
  end if;

  update public.balance_check_requests r
     set status = 'failed', error_code = 'timeout', finished_at = now(), viewer_url = null
   where r.household_id = hid
     and ((r.status = 'running' and r.started_at < now() - interval '5 minutes')
       or (r.status = 'awaiting_user' and r.started_at < now() - interval '15 minutes'));

  select * into req from public.balance_check_requests r
   where r.household_id = hid and r.status = 'pending'
   order by r.created_at
   for update skip locked
   limit 1;
  if not found then
    return;
  end if;

  update public.balance_check_requests r
     set status = 'running', started_at = now()
   where r.id = req.id;

  return query
    select req.id, c.id, m.auto_check, c.card_number, c.pin, m.balance_check_url
      from public.cards c join public.merchants m on m.id = c.merchant_id
     where c.id = req.card_id;
end $$;

revoke execute on function public.claim_balance_check() from public, anon;
grant execute on function public.claim_balance_check() to authenticated;
