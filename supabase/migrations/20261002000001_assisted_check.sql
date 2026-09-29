-- Assisted balance checks (e.g. Sport Chek on Givex).
--
-- Some balance pages demand an "I'm not a robot" check. The worker still does the
-- work: it opens the page on the household's own server and fills in the card.
-- Then it hands over to a person: the request becomes 'awaiting_user' and carries a
-- one-time link to a live view of that browser. The person solves the robot check
-- there, the worker reads the balance and completes the request as usual.
-- Nothing here solves or bypasses the robot check.

alter table public.merchants drop constraint merchants_auto_check_check;
alter table public.merchants
  add constraint merchants_auto_check_check check (auto_check in ('indigo', 'sportchek'));

alter table public.balance_check_requests drop constraint balance_check_requests_status_check;
alter table public.balance_check_requests
  add constraint balance_check_requests_status_check
  check (status in ('pending', 'running', 'awaiting_user', 'done', 'failed'));

-- Live-view link for an 'awaiting_user' request (the worker's own address plus a
-- one-time token). Cleared when the request finishes.
alter table public.balance_check_requests
  add column viewer_url text check (viewer_url is null or (viewer_url ~ '^https?://' and length(viewer_url) <= 500));

drop index public.balance_check_requests_active;
create unique index balance_check_requests_active
  on public.balance_check_requests (card_id) where status in ('pending', 'running', 'awaiting_user');

create or replace function public.request_balance_check(p_card_id uuid) returns uuid
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

-- Same as before, plus: requests left waiting for a person for 15 minutes (worker
-- crashed mid-handover) are failed too.
create or replace function public.claim_balance_check()
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
    select req.id, c.id, m.auto_check, c.card_number, c.pin
      from public.cards c join public.merchants m on m.id = c.merchant_id
     where c.id = req.card_id;
end $$;

-- Worker: the page is ready and needs a person; publish the live-view link.
create function public.await_user_balance_check(p_request_id uuid, p_viewer_url text) returns void
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
  update public.balance_check_requests
     set status = 'awaiting_user', viewer_url = p_viewer_url
   where id = req.id;
end $$;

create or replace function public.complete_balance_check(
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
  if req.status not in ('running', 'awaiting_user') then
    raise exception 'not_running' using errcode = 'P0001';
  end if;

  if p_balance_cents is not null then
    if p_balance_cents < 0 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;
    perform public.set_card_balance(req.card_id, p_balance_cents, 'Auto-check');
    update public.balance_check_requests
       set status = 'done', result_cents = p_balance_cents, finished_at = now(), viewer_url = null
     where id = req.id;
  else
    update public.balance_check_requests
       set status = 'failed',
           error_code = coalesce(nullif(p_error_code, ''), 'unknown'),
           finished_at = now(),
           viewer_url = null
     where id = req.id;
  end if;
end $$;

revoke execute on function public.await_user_balance_check(uuid, text) from public, anon;
grant execute on function public.await_user_balance_check(uuid, text) to authenticated;
