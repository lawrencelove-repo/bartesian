# Bartesian

Personal Bartesian capsule **inventory** + cocktail menu site: static HTML/JS for GitHub Pages, with SQLite (`sql.js`) in the browser.

See [PLAN.md](PLAN.md) for architecture and [PUNCHLIST.md](PUNCHLIST.md) for the living checklist.

## Quick start

Serve the project folder over HTTP (not as a `file://` page):

```bash
python3 -m http.server 8099
```

Open `http://127.0.0.1:8099/`.

On GitHub Pages, the same files are hosted from the repo root.

## Data flow

| Kind | Where it lives | Survives a new browser? |
|------|----------------|-------------------------|
| Catalog + seed quantities | `data/**` → `js/seed-data.js` in git | Yes |
| Local edits (qty, ratings) | This browser’s IndexedDB (SQLite blob) | No — export and commit to keep |

### Update GitHub from the client

1. Change inventory / ratings / notes in the app.
2. **Settings → Export data** (writes Pepperplate-style `.txt` files, or a zip).
3. Copy exports into `data/cocktails/` and `data/packs/` as needed.
4. Regenerate seed:
   ```bash
   node scripts/import-data.js
   ```
5. Commit and push `data/`, `js/seed-data.js`, and any `images/`.

## Barcodes (scaffold)

| Scan | Effect |
|------|--------|
| Capsule barcode | Quantity −1 |
| Single-flavor case | Quantity +8 (or configured case qty) |
| Variety pack | Adds each included cocktail’s pack qty |

Scaffold UI uses a manual barcode field; camera scanning can be added later.

## Regenerate seed

```bash
node scripts/import-data.js
```
