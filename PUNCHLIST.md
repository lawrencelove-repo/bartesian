# Punch list

Status for the Bartesian inventory + cocktail menu site (static HTML/JS on GitHub Pages, SQLite in the browser).

See [PLAN.md](PLAN.md) for architecture and data model.

## Done in this pass (scaffold)

- [x] Stack mirrored from recipes: HTML/JS, sql.js SQLite, IndexedDB, seed `data/` → `js/seed-data.js`, export for manual GitHub update
- [x] Folder layout (`css/`, `js/`, `data/cocktails/`, `data/packs/`, `images/`, `assets/`, `exports/`, `scripts/`)
- [x] Cocktail list (search, filter in-stock / favorites / spirit, sort name / quantity / rating / spirit)
- [x] Cocktail detail (metadata placeholders, inventory ± / Use 1, variety packs, ratings by person)
- [x] Barcode apply: capsule −1, case +N, variety pack restock (manual entry UI)
- [x] Randomizer (in-stock; optional spirit / favorites)
- [x] People management (add raters)
- [x] Settings: export zip/folder + reset local DB
- [x] Sample seed: 4 cocktails + 1 variety pack
- [x] Disclaimer + non-affiliation note (private use)
- [x] Service worker shell + favicons / webmanifest stubs
- [x] Light / clean visual direction (white UI, Bartesian-like teal accents, book-style detail sections)

## Next

### Catalog & admin

- [x] Real Bartesian catalog scrape (Gorgias nutrition articles + Shopify products) into `data/` + `images/`
- [x] Seasonal flag on cocktails + list filter
- [x] Rimmers table/page (`#/rimmers`) with pairings + inventory ±
- [x] Alcohol volume (Mocktail/Light/Regular/Strong) + nutrition label images
- [x] Product URLs with Shopify `?variant=` where the item is still sold online
- [x] Nutrition Facts label images from Gorgias (US + EU when present)
- [x] Shopify/Gorgias ID fields (`Shopify Product/Variant/Handle/SKU`, `Gorgias Article ID`)
- [x] Disabled stubs (`Enabled: 0`) for catalog items not currently sold on bartesian.com
- [x] Cocktail hero vs marketing images (`images/hero/`, `images/marketing/`) + nutrition at end of detail
- [x] Shopify long-form `Details` (Read More / how-to copy) on cocktail records
- [x] Reverse rimmer→cocktail pairings into `cocktail_rimmers` join (cocktail detail “Recommended rimmers”)
- [x] Fix variety pack `Items` parsing (bullet cocktail names, not flavor blurbs)
- [ ] **Cocktail admin page** — create / edit / disable cocktails (name, image, spirits, description, nutrition, alcohol, glassware, garnish, pairs-with, Bartesian URL, barcodes, case qty)
- [ ] Variety-pack admin (create/edit packs and item quantities)
- [ ] Richer metadata editors (structured nutrition / alcohol fields)
- [ ] Optional OCR of nutrition labels → calories/ingredients/case UPC into structured fields
- [ ] UI toggle to show disabled stubs; flip `Enabled` when SKUs return
- [ ] Fill remaining empty Bartesian URLs for discontinued/seasonal SKUs if product pages reappear

### Cookies (mahjong-tools pattern)

- [ ] Cookie-backed settings module like [mahjong-tools `js/settings.js`](https://github.com/lawrencelove-repo/mahjong-tools/blob/main/js/settings.js): `path=/`, `SameSite=Lax`, long `max-age`, read/write helpers
- [ ] Persist UI prefs in cookies (e.g. last filters/sort, favorites-only default, selected person for ratings, UI scale / theme if added)
- [ ] Soft site access gate cookie (optional; recipes-style password hash + cookie) if you want a deterrent on public Pages

### Safari & iPad

- [ ] Safari / iPadOS pass: layout, touch targets, safe-area insets (`viewport-fit=cover`, `env(safe-area-inset-*)`)
- [ ] Verify sql.js + IndexedDB persistence on Safari (private mode caveats documented)
- [ ] iPad-friendly nav and forms (no hover-only controls; large tap targets)
- [ ] PWA / Add to Home Screen polish on iPad Safari (manifest, apple-touch-icon already stubbed)
- [ ] Camera barcode scan that works on Safari when that feature lands (`getUserMedia` + fallbacks)

### Inventory & scan

- [x] Capsule barcode decode via [romkal/bartesian_barcode](https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md) + `pods_data.csv` drink map
- [x] Scan lookup → confirm (capsule/rimmer default −1, optional +1; case/pack restock preview)
- [x] Admin `#/admin/barcodes` to associate codes; export includes `barcodes.json` + Capsule/Case fields
- [x] Camera scanning: custom Bartesian Code128 C line scan + optional BarcodeDetector for retail GTINs
- [x] iPadOS Take photo / Choose image / Files via `<input type="file" accept="image/*">` (+ optional live scan)
- [x] Custom UPC-A/EAN-13 decoder for case/pack labels (iPad; no BarcodeDetector)
- [x] Merge seed Case/Capsule barcodes into existing IndexedDB on launch
- [ ] Inventory history UI (from `inventory_log`)
- [ ] Pack/case restock undo

### Polish

- [ ] Favorites UX polish
- [ ] Full export parity (ratings/people round-trip into seed if desired)
- [x] Cocktail detail iconography for garnish / pairs-with (book-style circular marks)
- [ ] Keep site private (no public marketing; access gate / robots as desired)
- [ ] Enable GitHub Pages from repo root and smoke on a real `*.github.io` URL (private household use)

### Design notes

Visual direction: white background, black type, teal accent (`#00a8c5`), boxed brand mark, uppercase section labels, generous whitespace — inspired by cocktail-book spreads and bartesian.com product pages. Not dark mode.

## Hosting notes

GitHub Pages cannot write a shared SQLite file for all visitors. Canonical data stays in git; each browser keeps a local IndexedDB copy until an admin exports and pushes.
