-- Row-level security: every row is scoped to household membership.

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.merchants         enable row level security;
alter table public.cards             enable row level security;
alter table public.transactions      enable row level security;

-- Nothing is readable or writable without signing in.
revoke all on all tables in schema public from anon;

-- households: insert/delete only via create_household().
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households
  for update to authenticated
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

-- household_members: insert only via create_household()/accept_household_invite().
create policy members_select on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));
create policy members_update_self on public.household_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy invites_select on public.household_invites
  for select to authenticated
  using (public.is_household_member(household_id));
create policy invites_insert on public.household_invites
  for insert to authenticated
  with check (public.is_household_member(household_id) and invited_by = (select auth.uid()));
create policy invites_delete on public.household_invites
  for delete to authenticated
  using (public.is_household_member(household_id));

create policy merchants_select on public.merchants
  for select to authenticated
  using (public.is_household_member(household_id));
create policy merchants_insert on public.merchants
  for insert to authenticated
  with check (public.is_household_member(household_id));
create policy merchants_update on public.merchants
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy merchants_delete on public.merchants
  for delete to authenticated
  using (public.is_household_member(household_id));

create policy cards_select on public.cards
  for select to authenticated
  using (public.is_household_member(household_id));
create policy cards_insert on public.cards
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy cards_update on public.cards
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy cards_delete on public.cards
  for delete to authenticated
  using (public.is_household_member(household_id));

-- transactions are append-only: no update/delete policies. Corrections are 'adjust' rows.
create policy transactions_select on public.transactions
  for select to authenticated
  using (exists (
    select 1 from public.cards c
    where c.id = card_id and public.is_household_member(c.household_id)));
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.cards c
      where c.id = card_id and public.is_household_member(c.household_id)));
