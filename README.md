# Gift Card Wallet

A private, installable web app (PWA) for a household to store and share e-gift cards,
track balances, and show a scannable barcode at the till.

- **Frontend:** Vite + React + TypeScript, Tailwind, TanStack Query (persisted to IndexedDB for offline).
- **Backend:** Supabase: Postgres with row-level security, Auth (email + password, invite-only), private Storage.
- **Auto-check worker:** optional Docker container (`worker/`) that checks balances with the merchant.
- **Barcodes:** decoded on-device with `zxing-wasm`, rendered with `bwip-js`.
- **Hosting:** Render static site (`render.yaml`).

Money is stored as integer cents. A card's balance is never stored: it is the sum of its
transactions (`card_balances` view). "Set balance" writes an `adjust` transaction for the difference.

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in your DEV Supabase project URL + anon key
npm run dev                  # http://localhost:5173
```

Never put production keys in `.env.local`. Production values live only in Render.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (service worker disabled in dev) |
| `npm run build` / `npm run preview` | Production build / serve it on :4173 |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc -b` |
| `npm test` | Unit tests (balance math, adjust delta, cents formatting, auto-archive, redaction) |
| `npm run test:db` | Applies every migration to a throwaway Postgres and tests RLS, RPCs and the ledger trigger. Needs `TEST_DATABASE_URL` (any Postgres ≥ 15; no Docker or Supabase required) |
| `npm run test:rls` | RLS + Storage against a live Supabase stack (see below) |
| `npm run test:e2e` | Playwright: invite → choose password → add card → spend → till barcode; password sign-in and reset; auto-check round trip through the real worker; offline cold start |
| `cd worker && npm test` | Worker unit tests |

`test:rls` and `test:e2e` need `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and
`SUPABASE_TEST_SERVICE_ROLE_KEY` for **local (`supabase start`) or the dev project only**.
They create and delete users. The service-role key is used only by the test runner, never
by the app bundle.

## Supabase setup

1. **Create two projects**: `giftcards-dev` and `giftcards-prod`.
2. **Apply migrations** (each project):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push          # applies supabase/migrations/*.sql
   ```
   Or paste each file in `supabase/migrations/` into the SQL editor, in order.
3. **Auth → Sign In / Providers → Email**:
   - Email provider **on**. **Allow new users to sign up: off** (invite only).
   - **Minimum password length: 10** (matches the app).
   - *(Pro plan)* turn on **Prevent use of leaked passwords**.
4. **Auth → URL Configuration**: set *Site URL* to your Render URL (prod) or
   `http://localhost:5173` (dev). Under *Redirect URLs* add the same address followed by
   `/**` (e.g. `https://giftcard-wallet-xxxx.onrender.com/**`); password-reset links
   return to `/set-password`.
5. *(Recommended)* **Auth → Email Templates**: use token-hash links so they work even if
   opened in a different browser than the one that asked:
   - *Invite user*: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a>`
   - *Reset password*: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a>`

   The default templates also work.
6. **Storage**: the migration creates the private `card-images` bucket and its policies.
   Nothing to click.
7. *(Recommended for prod)* **Auth → SMTP**: configure your own SMTP. Supabase's built-in
   sender is rate-limited.

## Creating the household

**In the app (recommended):** invite yourself first (**Authentication → Users → Invite user**;
signups are disabled, so this is how any account gets created). Open the invite link,
**choose a password**, enter your name, then tap **Create a new household**. This seeds Indigo (Books), Esso (Gas) and
Tim Hortons (Coffee). Balance-check URLs are left blank; add them under
**Settings → Merchants**.

**By SQL instead:** invite both people from the dashboard, edit the two emails in
`supabase/snippets/create_household.sql`, and run it in the SQL editor.

## Inviting the second household member

1. In the app: **Settings → Household → Invite someone**. Enter their email and name.
   This records a pending invite that only your household can see.
2. In Supabase: **Authentication → Users → Invite user**, with the same email. Supabase
   emails them a link. Public signups stay disabled.
3. They open the link, **choose a password**, enter their name, and tap
   **"I was invited — join my household"**. From then on they sign in with email + password.
   The `accept_household_invite()` function matches their verified email to the pending invite.

To remove someone: delete their row in `household_members` (SQL editor) and delete the
user under Authentication → Users.

## Signing in

Email + password. **Forgot password?** on the sign-in screen emails a reset link
(needs working email; see SMTP above). **Settings → Change password** changes it while
signed in. Accounts created before passwords existed are asked to choose one the next
time they open the app; if you're signed out, use **Forgot password?**.

## Deploying to Render

1. Render → **New → Blueprint** → select this repo. `render.yaml` defines a static site.
   Alternatively, create a *Static Site* with build command `npm ci && npm run build` and
   publish directory `dist`, then add a rewrite `/*` → `/index.html`.
2. Set environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the
   **production** project. They're baked in at build time; redeploy after changing them.
3. Add the Render URL (and any custom domain) to Supabase *Site URL* / *Redirect URLs*.
4. The blueprint sets a strict CSP allowing only `*.supabase.co`. If you use a Supabase
   custom domain, add it to `connect-src` and `img-src` in `render.yaml`.

## Security notes

- Every table and the storage bucket are scoped to household membership with RLS;
  anonymous access is revoked. The ledger is append-only.
- Card numbers and PINs never go in URLs (routes use UUIDs), query keys, logs or error
  messages. Server error text is never shown; errors are mapped to fixed messages and
  logged as bare codes (`src/lib/errors.ts`, `src/lib/redact.ts`). ESLint forbids
  `console.log`.
- PINs are masked everywhere until tapped, and re-mask after 10 s.
- There are no analytics or third-party scripts. The barcode decoder WASM is served from the app's own origin.
- **Offline cache:** card data, including numbers and PINs, is cached unencrypted in this
  device's IndexedDB so till mode works offline. It is erased on sign-out.

## Automatic balance checks

The **Check balance now (automatic)** button on a card queues a request. A small worker
running on your own server (Docker) picks it up within a few seconds, looks the balance
up with the merchant, and records it. It shows in the card's history as
**Balance set · Auto-check**.

- **Supported merchants: Indigo.** Indigo only shows balances to a signed-in Indigo account
  (account.indigo.ca → Gift Cards). So the worker keeps its own saved sign-in to *your*
  Indigo account, opens that page in a hidden browser, types the card number and PIN, and
  reads Indigo's reply (`{"success":true,"balance":…}`). It never records a guessed amount:
  anything unexpected fails with a clear message and changes nothing.
- **Sign-in expiry:** Indigo signs the worker out now and then (how often is up to Indigo).
  The app then says *"The checker's sign-in to the merchant has expired"*; re-run the link
  command below.
- **How the worker signs in to *this* app:** as its own ordinary account (an "Auto-check"
  household member) with email + password. It never has the Supabase service_role key, so
  row-level security still limits it to your household. Hidden from "Who has it?".
- **Privacy:** card numbers and PINs go only from Supabase to Indigo, exactly as when you
  check on Indigo's site. The worker logs request ids and outcome codes, never card data.
  The saved Indigo sign-in (`indigo-session.json` in the worker's Docker volume) works like
  a password for your Indigo account: keep the server private.

### Setup

1. **Create the Auto-check account:** Supabase → Authentication → Users → **Add user →
   Create new user**. Use an email you control (e.g. `autocheck@yourdomain`), a long random
   password, and tick **Auto Confirm User**.
2. **Add it to your household:** edit the two emails in
   `supabase/snippets/add_auto_check_member.sql` and run it in the SQL editor.
3. **Turn it on for Indigo:** in the app, **Settings → Merchants → Indigo → Automatic
   balance check → Indigo**. Make sure your Indigo cards have their PIN saved.
4. **Build the worker on your server:**
   ```bash
   git clone https://github.com/onionmansz/GC.git && cd GC/worker
   cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_ANON_KEY, WORKER_EMAIL, WORKER_PASSWORD
   docker compose build
   ```
5. **Link your Indigo account (one time, and again whenever it expires):**
   ```bash
   docker compose run --rm balance-worker npm run link-indigo
   ```
   It asks for your Indigo email; Indigo emails you a code; type it in. It says
   **"Linked."** when done.
6. **Start it:**
   ```bash
   docker compose up -d
   docker compose logs -f      # should say "signed in"
   ```
   It only makes outgoing connections (no ports to open). `docker ps` shows it as
   *healthy* while it's running. Update later with `git pull && docker compose up -d --build`.

**If linking on the server fails** (e.g. Indigo shows a "prove you're human" check), link
on a computer with a screen instead, then copy the result to the server:
```bash
# on the PC (Node 22+):
cd GC/worker && npm ci && npx playwright install chromium
npm run link-indigo -- --headed            # a browser opens; sign in normally
# copy worker/state/indigo-session.json to the server; then, with the worker running (docker compose up -d):
docker compose cp indigo-session.json balance-worker:/app/state/indigo-session.json
```

If you tap the button and it stays on "Queued…", the app tells you the worker doesn't
seem to be running.

**If checks fail with "the balance page has changed",** first check the worker log
(`docker compose logs`): each check line ends with its steps and timings, e.g.
`[page 2.1s, form 41.0s, reply 200 43.2s]`. Then run the diagnostic. It opens Indigo's
page exactly like a check does but types nothing, reports how long the form took to
appear and what's on the page, and saves a screenshot:
```bash
docker compose run --rm balance-worker npm run debug-indigo
docker compose cp balance-worker:/app/state/debug-indigo.png .
```
Add `-- --try-fake-card` to also submit an obviously fake card (0000…/0000) exactly like
a check and report the requests sent and Indigo's reply (screenshot: `debug-indigo-after.png`).

### Adding another merchant

Write a fetcher in `worker/src/fetchers/` (card number + PIN → cents, or throw a
`CheckError` code; see `indigo.ts`), register it in `worker/src/fetchers/index.ts`, add its id to the
`merchants.auto_check` check constraint (new migration) and to `src/lib/autoCheck.ts`.
