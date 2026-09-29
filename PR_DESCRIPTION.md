# Household gift card wallet — v1

## Summary

This adds a private, installable PWA for two people to store and share e-gift cards
(Indigo, Esso, Tim Hortons, …), track balances, and show a scannable barcode at the till.

- Vite + React + TypeScript, Tailwind, TanStack Query (persisted to IndexedDB for offline reads)
- Supabase Postgres with RLS on every table, magic-link Auth (signups disabled, invite only), and a private Storage bucket served through signed URLs
- On-device barcode decoding (`zxing-wasm`) from a screenshot, photo or PDF; rendering with `bwip-js`
- `vite-plugin-pwa` (injectManifest) for install and an offline app shell
- Render static-site blueprint with a strict CSP
- Money is stored as integer cents. Balances are derived, never stored. "Set balance" adds an `adjust` row for the difference.
- A `BalanceFetcher` interface only (no implementations), for the planned `feat/balance-checker-worker`.

## Schema

`supabase/migrations/` (5 files, applied in order):

| Object | Purpose |
| --- | --- |
| `households` | `id, name, created_at` |
| `household_members` | `(household_id, user_id)` PK, `display_name`, `unique(user_id)`: one household per user in v1 |
| `household_invites` | Pending invites by email; accepted via `accept_household_invite()` |
| `merchants` | `household_id, name, category, color, balance_check_url` (https only, nullable); name unique per household |
| `cards` | `merchant_id, label, card_number, pin, barcode_format, barcode_value, barcode_image_path, held_by, archived, balance_checked_at, created_by, created_at`. Composite FKs stop a card pointing at another household's merchant or holder. Card number is unique per merchant. |
| `transactions` | `type ∈ {load, spend, adjust}`, signed `amount_cents` (sign checked per type), `note, created_by, created_at`. **Append-only.** |
| `card_balances` (view) | `sum(amount_cents)` per card; `security_invoker` so RLS applies |
| `merchant_summaries` (view) | Per merchant: active card count and total balance |
| `create_household()` | First-run: creates the household, adds the caller, seeds Indigo/Esso/Tim Hortons (no URLs) |
| `accept_household_invite()` | Joins the household whose pending invite matches the caller's verified email |
| `create_card()` | Card plus opening `load` in one transaction (SECURITY INVOKER) |
| `set_card_balance()` | Locks the card, inserts an `adjust` for the delta, stamps `balance_checked_at` |
| `transactions_after_insert` trigger | Locks the card, **rejects negative balances**, sets `archived = (balance = 0)` |
| `cards_lock_columns` trigger | `household_id`, `created_by`, `created_at` are immutable |
| RLS | Every table uses `is_household_member()`; `anon` has no table privileges; no update/delete on transactions |
| Storage | Private `card-images` bucket (PNG/JPEG/WebP, 5 MB); object path `<household_id>/<uuid>.png`; policies check membership of the first path segment |

## Screens

- **Sign in:** email → magic link. `shouldCreateUser: false`; uninvited emails get the same response, so the form can't be used to check who has access.
- **Setup (first run):** "I was invited — join my household", or "Create a new household".
- **Home:** grand total; merchants with active cards grouped by category, each with its total and card count; "Last synced" time; link to Archived; floating "+ Add card" button.
- **Merchant:** active cards sorted **lowest balance first**, showing the masked number, label and holder. Edit merchant (name, category, colour, balance-check URL).
- **Card detail:** balance, masked number (tap to reveal), masked PIN, holder, last checked. Buttons: **Show at till**, **Spent $**, **Add funds**, **Set balance** (each previews the new balance), and **Check balance ↗**, which copies the card number and opens `balance_check_url` in a new tab (hidden when no URL is set). Ledger shows who, what and when. Archive/Unarchive, Delete.
- **Show at till:**
  - Full-screen white view with the barcode rendered from the stored value, and the card number in large monospace.
  - PIN is hidden until tapped and re-masks after 10 seconds.
  - Screen Wake Lock keeps the display on and is re-acquired when the app returns to the foreground.
  - Falls back to the uploaded image if there's no decoded value, or if the stored value is invalid for its format.
- **Add/Edit card:**
  - Pick a merchant, or create one inline.
  - Upload an image or PDF. It's decoded on the device, and the number and format are prefilled.
  - Advanced section to override the format or value by hand. Values are validated by test-rendering before save.
  - PIN field is masked with a Show toggle. Label and "Who has it?" are optional.
  - Opening balance creates a `load` transaction.
- **Archived:** cards at $0 (auto) or archived by hand, each with an Unarchive button.
- **Settings:** your display name, household name, members, invites (with steps), merchant management, "Clear offline data", Sign out.
- **Offline:** amber banner; all edit actions are disabled with a clear message; cached data (including till mode) stays viewable.

## Setup steps

1. **Supabase:** create `giftcards-dev` and `giftcards-prod` projects.
2. **Migrations:** `npx supabase link --project-ref <ref> && npx supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor in order).
3. **Auth settings:**
   - Email provider on; *Allow new users to sign up* **off**.
   - Site URL and Redirect URLs set to your Render URL (prod) or `http://localhost:5173` (dev).
   - Optional: switch the Magic Link template to the `token_hash` link shown in the README.
4. **Env vars:**
   - Locally: `cp .env.example .env.local` with the **dev** project's URL and anon key.
   - Render: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to **prod**.
5. **Household seeding:**
   - Invite yourself (Dashboard → Authentication → Users → Invite user), open the link, and tap **Create a new household**.
   - Then Settings → Invite someone (your wife's email), and invite the same email from the dashboard. She opens the link and taps **I was invited**.
   - SQL alternative: `supabase/snippets/create_household.sql`.
6. **Render deploy:** New → Blueprint → this repo (`render.yaml`). Set the two env vars, deploy, then add the URL to Supabase Redirect URLs.
7. **Balance-check URLs:** Settings → Merchants → each merchant → *Balance check page*. They're left blank on purpose.

## What was run

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run build` | ✅ |
| `npm test`: unit tests (money, ledger, adjust delta, auto-archive, redaction, error mapping, formats, grouping, time, cache lifetime) | ✅ 58 |
| `npm run test:db`: all migrations on Postgres 16 plus RLS, RPCs, trigger, invites | ✅ 19 |
| `npm run test:rls`: live PostgREST + GoTrue + Storage API. An outsider can't read cards, transactions, balances or barcode images (download, signed URL, list) | ✅ 6 |
| `npm run test:e2e`: Playwright, Pixel 7 profile. Magic-link sign-in → create household → upload a Code 128 screenshot → decode prefills the number → add card at $50 → spend $12.34 → balance $37.66 → till renders the barcode (checks pixels), PIN masked. Also asserts the card number never appears in URLs or console output. | ✅ |
| `npm run test:e2e` (second test, service worker on): go offline, cold-start the app → cached cards and total shown, offline banner, edits disabled, till still renders the barcode | ✅ |

**How the live runs were done:** there's no Docker in the build environment, so `test:rls` and `test:e2e` ran against the real Supabase services started from their release binaries and source: PostgREST v13, Supabase Auth v2.197, Storage API (file backend), and Postgres 16, behind a small gateway doing Kong's routing. That isn't the hosted platform. Please run both suites once against your **dev** project (commands in the README).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, `test:db` (Postgres service container) and the build on every PR.

## Known limitations

- **Screen brightness can't be raised from the web.** Turn brightness up by hand at the till; the till screen shows a hint.
- **Wake Lock:** supported in Safari 16.4+ and Chrome/Android. On older iOS the screen may dim.
- **Offline cache isn't encrypted.** Card numbers and PINs sit in IndexedDB on the device so till mode works offline. It's cleared on sign-out and by "Clear offline data". End-to-end encryption is out of scope for v1.
- **Uploaded images work offline only after they've been viewed online once** (cached by the service worker). Rendered barcodes need no network.
- **Edits need a connection.** Nothing is queued offline.
- **The offline cache lasts 14 days.** If the app isn't opened online for 14 days, the cache expires and needs a connection to reload.
- **On a weak connection the app shows cached data after ~1.5 s** instead of waiting for the session check. Nothing can be changed until the server responds.
- **One household per user** (`unique(user_id)`).
- **Removing a member** is done by SQL (see the README).
- **Spending more than the balance is rejected** by the database. A merchant that allows going negative isn't modelled.
- **Invites have two steps** (in-app invite plus dashboard "Invite user"), because signups are disabled and creating auth users needs the service key, which the client never has.
- **PDFs:** only the first page is scanned.
- **CSP** allows `*.supabase.co`. Adjust `render.yaml` if you use a custom Supabase domain.
- **Magic-link email:** Supabase's built-in email is rate-limited. Configure SMTP for production.

## Test checklist (iPhone + Android)

Do this on both an iPhone (Safari) and an Android phone (Chrome) unless noted.

**Install and auth**
- [ ] Open the Render URL, request a magic link, and open it on the phone; you're signed in.
- [ ] iPhone: Share → *Add to Home Screen*. Android: *Install app*. Launch from the icon; it opens standalone, with no browser bar.
- [ ] An uninvited email shows the same "check your email" message and never receives a link.
- [ ] Your wife: invite flow per README → she taps "I was invited" and sees the same cards.

**Cards**
- [ ] Add a card from a **screenshot** of an e-gift card email; the number and format are prefilled.
- [ ] Add a card from a **photo** of a physical card (camera option in the file picker).
- [ ] Add a card from a **PDF** e-gift card.
- [ ] Add a card whose image doesn't decode; you get the "No barcode found" message, can enter the number by hand, and till mode shows the original image.
- [ ] Opening balance appears on Home, in the category group and the merchant total.
- [ ] Merchant page lists cards lowest balance first.
- [ ] **Spent $** reduces the balance, and the ledger shows your name, amount and time.
- [ ] **Set balance** to a different amount adds an adjustment row for the difference and updates "Checked".
- [ ] Spending more than the balance is refused with a clear message.
- [ ] Spend to exactly $0.00: the card disappears from Home and appears in **Archived**. Unarchive works.
- [ ] Set a balance-check URL on a merchant: **Check balance** opens it in a new tab, and pasting gives the card number. With no URL, the button is hidden.
- [ ] The PIN is dots everywhere (detail, till, edit form) until tapped, and hides again after ~10 s.
- [ ] Changes made on one phone show up on the other after pull-to-refresh or reopening.

**Show at till**
- [ ] Till mode is white and full screen, and the barcode fills the width.
- [ ] Leave it open for 2+ minutes; the screen doesn't dim or lock (Safari 16.4+ / Chrome).
- [ ] Switch apps and come back; it still stays awake.
- [ ] **Real in-store scan:** at Tim Hortons, Esso or Indigo, have the cashier scan the phone. Record the format that worked, and whether the rendered barcode or the image fallback was used.
- [ ] Try a real 2D code (PDF417/QR) if any of your cards use one.

**Offline**
- [ ] Open the app once online, then turn on airplane mode and relaunch from the home screen. The cards load, the "Last synced" time shows, and the amber offline banner appears.
- [ ] Offline: Spent / Add funds / Set balance / Edit are disabled with the message; till mode still shows the barcode.
- [ ] Back online: the banner disappears and actions are enabled again.

**Security spot-checks**
- [ ] The address bar never shows a card number or PIN (only `/c/<uuid>` style URLs).
- [ ] Sign out, then use the browser back button: no card data is visible, and after going offline and relaunching you get the sign-in screen.
- [ ] Sign in as a different test user who isn't in your household: no cards are visible.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HNDxrouznNGHfWe2b4ndLw
