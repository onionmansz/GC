-- Add the "Auto-check" service member that the balance-check worker signs in as.
--
-- 1. Dashboard → Authentication → Users → Add user → "Create new user":
--    email e.g. autocheck@<your-domain> (any address you control), a long random
--    password, and tick "Auto Confirm User".
-- 2. Replace the two emails below (yours, and the Auto-check account), then run this.
-- 3. Put the Auto-check email + password in worker/.env on your server.
--
-- The worker uses this ordinary account (not the service_role key), so row-level
-- security still limits it to your household. It can't sign in to the app UI
-- usefully and is hidden from "Who has it?".

insert into public.household_members (household_id, user_id, display_name, is_service)
select me.household_id, bot.id, 'Auto-check', true
  from public.household_members me
  join auth.users you on you.id = me.user_id and you.email = lower('you@example.com')
  cross join auth.users bot
 where bot.email = lower('autocheck@example.com')
on conflict do nothing;

-- Check: should list you, your partner, and "Auto-check (service)".
select display_name, case when is_service then '(service)' else '' end as kind
  from public.household_members
 order by joined_at;
