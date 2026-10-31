# Bartesian: Cloudflare Workers + D1 migration

Development branch: `feature/cloudflare-d1`.  
Legacy GitHub Pages app: `legacy` branch (unchanged).  
Do **not** merge into `main` or deploy production until verified and approved.

| Resource | Value |
|---|---|
| Worker name | `bartesian` |
| D1 database | `bartesian-db` |
| Binding | `DB` |
| Account ID (shared with Recipes) | `bfe38ff4f7a7cff066e54569c3b2560b` |
| D1 `database_id` | `8170b114-9648-4e2f-8432-30cf1d227362` |

## Architecture (implemented)

- **Cloudflare Workers** serve curated static assets from `dist/` and handle API/auth.
- **Cloudflare D1** is the authoritative inventory/catalog database.
- **Browser sql.js** remains an in-memory compatibility layer so the existing synchronous UI keeps working.
- On load (Cloudflare build only), the client fetches `GET /api/snapshot` and hydrates sql.js.
- Writes go through `POST /api/mutate` then re-hydrate from D1.
- **Email OTP auth** (Resend): 6-digit codes, 10-minute expiry, 30-day HttpOnly sessions, rate limits.
- Authorized recipients come from Worker var `AUTHORIZED_EMAILS` (comma-separated), not hardcoded in client JS.
- Login uses canonical `/login` (not `/login.html`) to avoid Static Assets redirect loops.
- Cloudflare mode is marked explicitly with `window.BARTESIAN_CLOUDFLARE = true` at build time.

## Original application (legacy)

- Vanilla HTML/CSS/JS on GitHub Pages.
- Persistence: sql.js SQLite blob in IndexedDB (`bartesian-sqlite`).
- Canonical seed: `data/**` → `js/seed-data.js`.
- Local edits survive only in the browser until Settings → Export → commit.

## Schema & migrations

| File | Purpose |
|---|---|
| `migrations/0001_schema.sql` | Application tables (schema version 9) |
| `migrations/0002_auth.sql` | login_codes, sessions, login_requests |
| `seeds/bartesian_seed.sql` | Generated seed (manual import only; not a Wrangler migration) |

Generate seed:

```bash
npm run seed:generate
```

Import once into an empty remote database (manual workflow or):

```bash
npx wrangler d1 migrations apply bartesian-db --remote
npx wrangler d1 execute bartesian-db --remote --file=seeds/bartesian_seed.sql
```

**Do not** re-import seed after live inventory edits.

## Seed inventory (from repo at generation time)

Run `npm run seed:generate` and inspect `seeds/bartesian_seed_summary.json`. Typical counts:

- people, cocktails, packs, rimmers, barcodes, activity, book layouts

Ratings/wishlist may be empty in git. **Browser-only IndexedDB edits are not in the repo** — export from Settings on each device before cutover if those edits matter.

## Auth setup

See [AUTH_SETUP.md](AUTH_SETUP.md).

Required secrets (never commit):

- `CLOUDFLARE_API_TOKEN` (GitHub Actions)
- `RESEND_API_KEY` (Worker secret)
- `AUTH_SECRET` (Worker secret, ≥32 random bytes)

Worker vars (in `wrangler.jsonc`):

- `EMAIL_FROM` — start with `onboarding@resend.dev` for testing; use a verified domain for production
- `AUTHORIZED_EMAILS` — comma-separated allowlist (codes always send to the first address). Initial testing: `lawrencelove@gmail.com`

## Local development

```bash
npm install
npm run seed:generate
# After creating D1 and setting database_id:
npm run db:migrate:local
npx wrangler d1 execute bartesian-db --local --file=migrations/0002_seed_data.sql
npm run dev
```

## GitHub Actions

| Workflow | Trigger | Purpose |
|---|---|---|
| `validate-cloudflare.yml` | push/PR | syntax, seed, build, asset checks, tests |
| `deploy-cloudflare.yml` | **manual** | deploy Worker from `main` |
| `import-d1-manual.yml` | **manual** (`confirm=IMPORT`) | remote schema + one-time seed |

Automatic production deploy from `main` is prepared but left manual until you approve enabling it.

## Backup / restore

**Backup**

1. Settings → Export data (zip of catalog/activity/book).
2. Or: `npx wrangler d1 export bartesian-db --remote --output=backup.sql`

**Restore**

1. Prefer restoring from export zip via the existing import scripts into a fresh DB seed, then re-import once.
2. Or execute a D1 SQL dump against an empty database (destructive — ask before overwriting production).

## GitHub Pages cutover (requires approval)

1. Keep Cloudflare on `feature/cloudflare-d1` until validated.
2. Switch GitHub Pages source to branch `legacy`.
3. After approval, merge Cloudflare work to `main` and deploy Worker.
4. Do not delete `legacy`.

## Known gaps / remaining work

- Create D1 database and replace `PENDING_CREATE_D1_DATABASE` in `wrangler.jsonc`.
- Configure GitHub secrets and run first remote migrate + seed.
- End-to-end OTP login test against Resend.
- Optional: automatic deploy on `main` after approval.
- Optional: R2 for large image assets (images currently ship as Worker static assets).
