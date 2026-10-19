# Bartesian — scaffold plan

Personal inventory + cocktail menu app for the Bartesian capsule ecosystem. Stack mirrors the [recipes](https://github.com/lawrencelove-repo/recipes) site: static HTML/JS, browser SQLite (`sql.js`), IndexedDB persistence, GitHub Pages hosting, manual export → commit to update canonical data.

## Goals (product)

1. **Inventory first** — track capsule quantity on hand; ± UI; “use one” decrements.
2. **Cocktail catalog** — one page per cocktail: name, image, spirits, description, nutrition, alcohol amounts, glassware, garnish, pairs-with, Bartesian.com link.
3. **Ratings & comments** — per person (select or add); aggregate rating for sorting.
4. **Barcodes** — capsule → −1; single-flavor case → +8; variety pack → add each included flavor’s count.
5. **Variety packs** — stored in DB; cocktail detail lists packs that contain it.
6. **List** — all by default; filter availability / spirit(s) / favorites; sort quantity / rating / name / spirit.
7. **Randomizer** — pick from available stock; optional spirit + favorites-only constraints.

## Non-goals (this scaffold)

- Full camera barcode UX (scaffold: manual barcode field; camera later).
- Live sync / server API (GitHub Pages is static; admins export and push).
- Official Bartesian affiliation or scraped catalog dump (seed placeholders only).
- Multi-device shared live inventory without export (each browser has its own IndexedDB until re-seeded from repo).

## Stack (same as recipes)

| Layer | Choice |
|-------|--------|
| UI | Vanilla HTML + CSS + JS (hash routes) |
| DB | SQLite via sql.js (WASM) |
| Persistence | IndexedDB blob of the SQLite file |
| Canonical data | `data/**/*.txt` in git → `js/seed-data.js` |
| Admin update | In-app export → overwrite `data/` → `node scripts/import-*.js` → commit/push |
| Host | Public GitHub Pages (repo root) |
| Offline | Service worker cache of static assets |

## Folder structure

```
bartesian/
  index.html
  sw.js
  css/styles.css
  js/
    db.js           # schema, queries, inventory + scan helpers
    seed-data.js    # generated from data/
    export.js       # DB → Pepperplate-like .txt / zip
    barcodes.js     # resolve barcode → inventory mutation
    app.js          # views + routing
  data/
    cocktails/      # one .txt per cocktail (catalog + qty seed)
    packs/          # variety pack definitions
  images/           # committed cocktail photos
  assets/favicon/
  exports/          # local export target (.gitkeep)
  scripts/
    import-data.js  # data/** → js/seed-data.js
  PLAN.md
  README.md
  DISCLAIMER.md
```

## Data model (SQLite)

```
people(id, name, created_at)
spirits(id, name)                         -- whiskey, vodka, tequila, …
cocktails(
  id, slug, name, description, image,
  glassware, garnish, pairs_with,
  nutrition_json, alcohol_json,          -- flexible structured blobs
  bartesian_url, favorite, enabled,
  quantity,                              -- on-hand capsules
  created_at, updated_at
)
cocktail_spirits(cocktail_id, spirit_id) -- M:N
barcodes(
  id, code UNIQUE, kind,                 -- 'capsule' | 'case' | 'variety_pack'
  cocktail_id NULL,                      -- capsule/case target
  pack_id NULL,                          -- variety pack target
  case_qty INTEGER DEFAULT 8             -- for single-flavor cases
)
packs(id, slug, name, barcode, notes)
pack_items(pack_id, cocktail_id, qty)
ratings(id, cocktail_id, person_id, stars, comment, created_at, updated_at)
inventory_log(id, cocktail_id, delta, reason, barcode, created_at)
meta(key, value)                         -- schema_version, etc.
```

### Barcode rules

| Scan | Kind | Effect |
|------|------|--------|
| Capsule | `capsule` | `quantity -= 1` (floor at 0), log `use` |
| Single-flavor case | `case` | `quantity += case_qty` (default 8), log `restock_case` |
| Variety pack | `variety_pack` | for each `pack_items` row, `quantity += qty`, log `restock_pack` |

### Seed / export contract

Cocktail text (`data/cocktails/Example.txt`):

```
Name: Example Cocktail
Slug: example-cocktail
Description: …
Spirits: Vodka, Rum
Glassware: Coupe
Garnish: Lime wheel
Pairs With: …
Nutrition: {"calories":120,"sugar_g":8}
Alcohol: {"abv_pct":12,"volume_ml":200}
Bartesian URL: https://www.bartesian.com/…
Image: images/example.jpg
Favorite: 0
Quantity: 2
Capsule Barcode: 012345678901
Case Barcode: 012345678918
Case Qty: 8
```

Pack text (`data/packs/SummerVariety.txt`):

```
Name: Summer Variety
Slug: summer-variety
Barcode: 098765432109
Items:
	example-cocktail: 2
	other-cocktail: 2
```

## Views (scaffold)

| Route | Purpose |
|-------|---------|
| `#/` | Cocktail list (search, filters, sort) |
| `#/cocktail/:id` | Detail + inventory ± / use one + ratings + packs |
| `#/scan` | Barcode entry (camera later) |
| `#/random` | Randomizer with spirit / favorites / in-stock |
| `#/people` | Manage people for ratings |
| `#/settings` | Export data for GitHub update; reset local DB |
| `#/disclaimer` | Non-affiliation notice |

## Scaffold vs later

**In this PR (scaffold):** schema, seed pipeline, list/detail/scan/random/settings shells, inventory ± and barcode apply, sample cocktails + one variety pack, GitHub Pages-ready static site.

**Next passes:** richer cocktail metadata UI, camera scan, polish filters/sort, favorites, full export parity, real catalog + images, password gate if desired.

## Defaults (assumed unless you change them)

- Quantity lives on the cocktail row (simple inventory); history in `inventory_log`.
- Ratings are 1–5 stars + optional comment, keyed by person.
- Sort-by-spirit uses primary spirit name (first linked spirit).
- “Available” filter = `quantity >= 1`.
- Soft site password deferred (easy to add like recipes).
- Public Pages from `main` / root (enable in repo Settings → Pages).
