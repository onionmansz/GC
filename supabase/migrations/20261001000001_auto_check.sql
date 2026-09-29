-- Automated balance checks.
--
-- The app queues a request ("Check now"). A worker on the household's own server
-- signs in as a dedicated service member (household_members.is_service), claims the
-- request, looks the balance up on the merchant's site and records it through
-- set_card_balance(), so the ledger shows it as an 'adjust' by that member.
-- The worker uses an ordinary user session: no service-role key, RLS still applies.

-- A member row used by an automated worker (hidden from people pickers).
alter table public.household_members
  add column is_service boolean not null default false;

-- Members may rename themselves, nothing else. is_service is set only via SQL.
revoke update on public.household_members from authenticated;
grant update (display_name) on public.household_members to authenticated;

-- Which automated checker (if any) handles this merchant's cards.
alter table public.merchants
  add column auto_check text check (auto_check in ('indigo'));

-- Expose it to the app alongside the other merchant fields (new columns go last).
create or replace view public.merchant_summaries with (security_invoker = true) as
select m.id                                                          as merchant_id,
       m.household_id,
       m.name,
       m.category,
       m.color,
       m.balance_check_url,
       count(c.id) filter (where not c.archived)                     as active_card_count,
       coalesce(sum(b.balance_cents) filter (where not c.archived), 0)::bigint
                                                                     as total_balance_cents,
       m.auto_check
from public.merchants m
left join public.cards c         on c.merchant_id = m.id
left join public.card_balances b on b.card_id = c.id
group by m.id;

create table public.balance_check_requests (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  card_id      uuid not null references public.cards (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed')),
  result_cents bigint check (result_cents is null or result_cents >= 0),
  -- Short machine code only (e.g. 'captcha'); never page text, which could echo card data.
  error_code   text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
-- At most one active request per card; "Check now" twice returns the same request.
create unique index balance_check_requests_active
  on public.balance_check_requests (card_id) where status in ('pending', 'running');
create index balance_check_requests_pending
  on public.balance_check_requests (created_at) where status = 'pending';

alter table public.balance_check_requests enable row level security;
revoke all on public.balance_check_requests from anon;
-- Written only through the functions below.
revoke insert, update, delete on public.balance_check_requests from authenticated;

create policy balance_check_requests_select on public.balance_check_requests
  for select to authenticated
  using (public.is_household_member(household_id));

create function public.is_service_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid()) and m.is_service
  );
$$;

-- App: queue a check for a card whose merchant has an automated checker.
create function public.request_balance_check(p_card_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c   record;
  rid uuid;
begin
  select cards.id, cards.household_id, merchants.auto_check into c
    from public.cards join public.merchants on merchants.id = cards.merchant_id
   where cards.id = p_card_id;
  if not found or not public.is_household_member(c.household_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if c.auto_check is null then
    raise exception 'not_supported' using errcode = 'P0001';
  end if;

  select id into rid from public.balance_check_requests
   where card_id = p_card_id and status in ('pending', 'running');
  if found then
    return rid;
  end if;

  insert into public.balance_check_requests (household_id, card_id, requested_by)
  values (c.household_id, p_card_id, auth.uid())
  returning id into rid;
  return rid;
exception when unique_violation then
  -- Raced with the other member's tap: return theirs.
  select id into rid from public.balance_check_requests
   where card_id = p_card_id and status in ('pending', 'running');
  return rid;
end $$;

-- Worker: take the oldest pending request in the caller's household (service members only).
-- Requests stuck in 'running' for 5 minutes (worker crashed) are failed first.
create function public.claim_balance_check()
returns table (request_id uuid, card_id uuid, provider text, card_number text, pin text)
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
     set status = 'failed', error_code = 'timeout', finished_at = now()
   where r.household_id = hid and r.status = 'running' and r.started_at < now() - interval '5 minutes';

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
    select req.id, c.id, m.auto_check, c.card_number, c.pin
      from public.cards c join public.merchants m on m.id = c.merchant_id
     where c.id = req.card_id;
end $$;

-- Worker: report the outcome. A balance is recorded via set_card_balance() as the
-- calling service member, so it appears in the ledger like any other adjustment.
create function public.complete_balance_check(
  p_request_id    uuid,
  p_balance_cents bigint default null,
  p_error_code    text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  req public.balance_check_requests;
begin
  select * into req from public.balance_check_requests where id = p_request_id for update;
  if not found or not public.is_service_member(req.household_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if req.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;

  if p_balance_cents is not null then
    if p_balance_cents < 0 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;
    -- set_card_balance is SECURITY INVOKER; auth.uid() is still the service member.
    perform public.set_card_balance(req.card_id, p_balance_cents, 'Auto-check');
    update public.balance_check_requests
       set status = 'done', result_cents = p_balance_cents, finished_at = now()
     where id = req.id;
  else
    update public.balance_check_requests
       set status = 'failed',
           error_code = coalesce(nullif(p_error_code, ''), 'unknown'),
           finished_at = now()
     where id = req.id;
  end if;
end $$;

revoke execute on function
  public.is_service_member(uuid),
  public.request_balance_check(uuid),
  public.claim_balance_check(),
  public.complete_balance_check(uuid, bigint, text)
from public, anon;
grant execute on function
  public.is_service_member(uuid),
  public.request_balance_check(uuid),
  public.claim_balance_check(),
  public.complete_balance_check(uuid, bigint, text)
to authenticated;
