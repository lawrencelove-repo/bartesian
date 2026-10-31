# Bartesian

Private household Bartesian capsule **inventory** + cocktail menu.

| Track | Hosting | Data |
|------|---------|------|
| `legacy` | GitHub Pages | Browser sql.js + IndexedDB |
| `feature/cloudflare-d1` → future `main` | Cloudflare Workers | Cloudflare D1 (+ in-memory sql.js UI layer) |

See [CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md) for the Workers/D1 architecture and [AUTH_SETUP.md](AUTH_SETUP.md) for OTP login. Product plan: [PLAN.md](PLAN.md). Checklist: [PUNCHLIST.md](PUNCHLIST.md).

## Quick start (legacy / local static)

```bash
python3 -m http.server 8099
```

Open `http://127.0.0.1:8099/`.

## Quick start (Cloudflare branch)

```bash
npm install
npm run seed:generate
npm test
npm run build
# After D1 database_id is configured:
# npm run db:migrate:local
# npx wrangler d1 execute bartesian-db --local --file=seeds/bartesian_seed.sql
# npm run dev
```

## Data flow

| Kind | Legacy | Cloudflare |
|------|--------|------------|
| Catalog seed | `data/**` → `js/seed-data.js` | Imported once into D1 |
| Inventory / ratings / activity | IndexedDB until export | D1 via authenticated API |
| Multi-device sync | Manual export/commit | Shared after sign-in |

### Browser-only data warning

If you edited inventory only in a browser and never exported, that data is **not** in git. Use **Settings → Export data** on each device before relying on the D1 import.

### Regenerate seed (git catalog)

```bash
node scripts/import-data.js
npm run seed:generate
```

## Barcodes

| Scan | Effect |
|------|--------|
| Capsule barcode | Quantity −1 |
| Single-flavor case | Quantity +8 (or configured case qty) |
| Variety pack | Adds each included cocktail’s pack qty |
