-- Alternative to the in-app first-run screen: create the household and add both
-- members from the Supabase SQL editor (runs as postgres, so RLS is bypassed).
--
-- 1. Invite both people first (Dashboard → Authentication → Users → "Invite user"),
--    so they exist in auth.users.
-- 2. Replace the two emails and display names below, then run this whole script once.

do $$
declare
  hid uuid;
  u1  uuid := (select id from auth.users where email = lower('you@example.com'));
  u2  uuid := (select id from auth.users where email = lower('partner@example.com'));
begin
  if u1 is null or u2 is null then
    raise exception 'Both users must exist in auth.users first (invite them from the dashboard).';
  end if;

  insert into public.households (name) values ('Home') returning id into hid;

  insert into public.household_members (household_id, user_id, display_name) values
    (hid, u1, 'You'),
    (hid, u2, 'Partner');

  -- Same seed merchants the app creates. balance_check_url left blank on purpose.
  insert into public.merchants (household_id, name, category, color) values
    (hid, 'Indigo',      'Books',  '#1f2a44'),
    (hid, 'Esso',        'Gas',    '#d52b1e'),
    (hid, 'Tim Hortons', 'Coffee', '#c8102e');

  raise notice 'Household created: %', hid;
end $$;
