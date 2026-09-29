-- Worker startup: release checks a previous run of the worker left in progress.
--
-- A household has one worker, which runs one check at a time, so anything still
-- 'running' or 'awaiting_user' when it starts belongs to a run that was stopped
-- (restart, crash, config change). Without this, the app would keep offering that
-- run's dead live-view link, and "Check now" would return the same stuck request,
-- until the 5/15-minute sweep in claim_balance_check().
create function public.release_balance_checks() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  n   integer;
begin
  select m.household_id into hid from public.household_members m
   where m.user_id = auth.uid() and m.is_service;
  if hid is null then
    raise exception 'not_service_member' using errcode = 'P0001';
  end if;

  update public.balance_check_requests r
     set status = 'failed', error_code = 'interrupted', finished_at = now(), viewer_url = null
   where r.household_id = hid and r.status in ('running', 'awaiting_user');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.release_balance_checks() from public, anon;
grant execute on function public.release_balance_checks() to authenticated;
