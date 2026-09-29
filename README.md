# Gift Card Wallet

A private, installable web app (PWA) for a household to store and share e-gift cards,
track balances, and show a scannable barcode at the till.

- **Frontend:** Vite + React + TypeScript, Tailwind, TanStack Query (persisted to IndexedDB for offline).
- **Backend:** Supabase: Postgres with row-level security, Auth (magic link, invite-only), private Storage.
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
| `npm run test:e2e` | Playwright: add card → spend → balance → till barcode; plus an offline cold start (service worker on) |

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
3. **Auth → Sign In / Providers**:
   - Email provider **on**. **Allow new users to sign up: off** (invite only).
   - Magic link / OTP expiry: 1 hour is fine.
4. **Auth → URL Configuration**: set *Site URL* to your Render URL (prod) or
   `http://localhost:5173` (dev), and add both to *Redirect URLs*.
5. *(Recommended)* **Auth → Email Templates → Magic Link**: use a token-hash link so it works
   even if opened in a different browser:
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a>
   ```
   The default template also works.
6. **Storage**: the migration creates the private `card-images` bucket and its policies.
   Nothing to click.
7. *(Recommended for prod)* **Auth → SMTP**: configure your own SMTP. Supabase's built-in
   sender is rate-limited.

## Creating the household

**In the app (recommended):** invite yourself first (**Authentication → Users → Invite user**;
signups are disabled, so this is how any account gets created). Open the invite link, enter
your name, then tap **Create a new household**. This seeds Indigo (Books), Esso (Gas) and
Tim Hortons (Coffee). Balance-check URLs are left blank; add them under
**Settings → Merchants**.

**By SQL instead:** invite both people from the dashboard, edit the two emails in
`supabase/snippets/create_household.sql`, and run it in the SQL editor.

## Inviting the second household member

1. In the app: **Settings → Household → Invite someone**. Enter their email and name.
   This records a pending invite that only your household can see.
2. In Supabase: **Authentication → Users → Invite user**, with the same email. Supabase
   emails them a sign-in link. Public signups stay disabled.
3. They open the link, enter their name, and tap **"I was invited — join my household"**.
   The `accept_household_invite()` function matches their verified email to the pending invite.

To remove someone: delete their row in `household_members` (SQL editor) and delete the
user under Authentication → Users.

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

## Adding automated balance checks later

`src/balance/BalanceFetcher.ts` defines `BalanceFetcher` (`merchantId → fetch(card) → cents | null`)
with an empty registry. A future worker records results through the existing
`set_card_balance` RPC, so no schema change is needed.
