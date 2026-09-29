-- Household gift card wallet: core tables.
-- Money is stored as integer cents. A card's balance is never stored; it is the
-- sum of its transactions (see the card_balances view).

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  -- v1: a user belongs to exactly one household.
  unique (user_id)
);

create table public.household_invites (
  household_id uuid not null references public.households (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  invited_by   uuid not null default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (household_id, email)
);
create unique index household_invites_pending_email
  on public.household_invites (email) where accepted_at is null;

create table public.merchants (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  name              text not null check (length(btrim(name)) between 1 and 80),
  category          text not null default 'Other' check (length(btrim(category)) between 1 and 40),
  color             text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  balance_check_url text check (balance_check_url is null or balance_check_url ~* '^https://'),
  created_at        timestamptz not null default now(),
  -- Target for the cards composite FK, so a card can't point at another household's merchant.
  unique (household_id, id)
);
create unique index merchants_household_name on public.merchants (household_id, lower(name));

create table public.cards (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  merchant_id        uuid not null,
  label              text check (label is null or length(label) <= 80),
  card_number        text not null check (length(btrim(card_number)) between 1 and 64),
  pin                text check (pin is null or length(pin) between 1 and 32),
  barcode_format     text check (barcode_format in (
                       'code128', 'code39', 'code93', 'codabar', 'ean13', 'ean8', 'upca', 'upce',
                       'itf', 'pdf417', 'qrcode', 'datamatrix', 'aztec')),
  barcode_value      text check (barcode_value is null or length(barcode_value) between 1 and 1024),
  barcode_image_path text check (barcode_image_path is null
                                 or barcode_image_path like household_id::text || '/%'),
  held_by            uuid,
  archived           boolean not null default false,
  balance_checked_at timestamptz,
  created_by         uuid not null default auth.uid() references auth.users (id),
  created_at         timestamptz not null default now(),
  constraint cards_barcode_pair check ((barcode_format is null) = (barcode_value is null)),
  constraint cards_merchant_fk foreign key (household_id, merchant_id)
    references public.merchants (household_id, id) on delete restrict,
  constraint cards_holder_fk foreign key (household_id, held_by)
    references public.household_members (household_id, user_id) on delete set null (held_by)
);
create unique index cards_unique_number on public.cards (household_id, merchant_id, card_number);
create index cards_household_archived on public.cards (household_id, archived);
create index cards_merchant on public.cards (merchant_id);

create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.cards (id) on delete cascade,
  type         text not null check (type in ('load', 'spend', 'adjust')),
  amount_cents bigint not null,
  note         text check (note is null or length(note) <= 200),
  created_by   uuid not null default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now(),
  constraint transactions_amount_sign check (
       (type = 'load'   and amount_cents > 0)
    or (type = 'spend'  and amount_cents < 0)
    or (type = 'adjust' and amount_cents <> 0))
);
create index transactions_card_created on public.transactions (card_id, created_at desc);
