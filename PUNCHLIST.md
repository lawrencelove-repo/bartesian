# Punch list

Status for the Bartesian inventory + cocktail menu site (static HTML/JS on GitHub Pages, SQLite in the browser).

See [PLAN.md](PLAN.md) for architecture and data model.

## Done in this pass (scaffold)

- [x] Stack mirrored from recipes: HTML/JS, sql.js SQLite, IndexedDB, seed `data/` → `js/seed-data.js`, export for manual GitHub update
- [x] Folder layout (`css/`, `js/`, `data/cocktails/`, `data/packs/`, `images/`, `assets/`, `exports/`, `scripts/`)
- [x] Cocktail list (search, filter in-stock / favorites / spirit, sort name / quantity / rating / spirit / seasonal)
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
- [x] Rimmer favorites (Add/Remove from Favorites on list + detail, ★ indicator) + Favorites filter on Rimmers list
- [x] Rimmers list In stock filter; rimmer qty badge: 1 = black (red only at 0 + restock flag)
- [x] Alcohol volume (Mocktail/Light/Regular/Strong) + nutrition label images
- [x] Product URLs with Shopify `?variant=` where the item is still sold online
- [x] Nutrition Facts label images from Gorgias (US + EU when present)
- [x] Shopify/Gorgias ID fields (`Shopify Product/Variant/Handle/SKU`, `Gorgias Article ID`)
- [x] Disabled stubs (`Enabled: 0`) for catalog items not currently sold on bartesian.com
- [x] Cocktail hero vs marketing images (`images/hero/`, `images/marketing/`) + nutrition at end of detail
- [x] Shopify long-form `Details` (Read More / how-to copy) on cocktail records
- [x] Reverse rimmer→cocktail pairings into `cocktail_rimmers` join (cocktail detail “Recommended rimmers”)
- [x] Fix variety pack `Items` parsing (bullet cocktail names, not flavor blurbs)
- [x] Admin submenu (gated): Scan, Barcodes, Cocktails, Rimmers, Packs, People — Admin cookie `bartesian_admin` mirrors Lawrence's `people.is_admin`
- [x] Admin screens: Cocktails (qty/favorite/seasonal/enable toggles), Rimmers (qty/fav/enable + name & free-text type edit), Packs (enable + items), People (add + Admin flag toggle)
- [ ] **Full cocktail create/edit form** — name, image, spirits, description, nutrition, alcohol, glassware, garnish, pairs-with, URLs, barcodes, case qty
- [ ] Variety-pack create/edit (packs and item quantities)
- [ ] Richer metadata editors (structured nutrition / alcohol fields)
- [ ] Optional OCR of nutrition labels → calories/ingredients/case UPC into structured fields
- [ ] UI toggle to show disabled stubs; flip `Enabled` when SKUs return
- [ ] Fill remaining empty Bartesian URLs for discontinued/seasonal SKUs if product pages reappear

### Cookies (mahjong-tools pattern)

- [x] Cookie helpers (`path=/`, `SameSite=Lax`, long `max-age`) for list prefs
- [x] Persist cocktail list prefs in cookie `bartesian_list_prefs` (search, sort incl. Seasonal, spirit, in-stock / favorites)
- [ ] Cookie-backed settings module like [mahjong-tools `js/settings.js`](https://github.com/lawrencelove-repo/mahjong-tools/blob/main/js/settings.js) (shared read/write helpers)
- [ ] Persist more UI prefs (selected person for ratings, UI scale / theme if added)
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
- [ ] Pack/case restock undo
- [x] Cocktail list: qty badge (left; red when qty = 1), A–Z# jump rail, wrapping filter checkboxes, cookie-backed filters/sort
- [x] List filters: In-stock AND Favorites checked = union (in-stock OR favorite); Seasonal moved to Sort dropdown

### Wishlist

Shopping/want list for cocktails and rimmers you do not currently own (or want more of).

**Data:**
- [x] `wishlist_items`: `id`, `cocktail_id` nullable, `rimmer_id` nullable, `qty_wanted` (editable, default 1), `created_at`; dedupe per item (Add increments want qty)
- [x] Add-to-wishlist action on cocktail detail, rimmer detail, and Restock screen
- [x] Remove from wishlist (does not affect inventory/catalog rows)

**Wishlist screen `#/wishlist`:**
- [x] List wishlist cocktails + rimmers with thumbnail/name
- [x] Per item: qty stepper for `qty_wanted`, Remove button
- [x] Per item: Bartesian link as a simple arrow (↗) using `bartesian_url` (hidden if no URL)
- [x] Nav/menu entry for Wishlist
- [x] Empty state with hint to add from detail or Restock

**Import / export:**
- [x] Include wishlist in export zip (`wishlist.json`)
- [x] Import/seed path restores wishlist (dedupe by slug/item); seed-rev merge updates want qty

### Restock

Auto-flag cocktails and rimmers that just ran out so they show on a dedicated buying list. (Formerly “Reorder”.)

**Flag rules:**
- [x] `restock` flag on cocktails AND rimmers (`restock INTEGER DEFAULT 0`, migrated in-place)
- [x] Set `restock = 1` ONLY on 1 → 0 transition (Use 1, capsule −1 scan, manual −1); do NOT backfill items already at 0. List badge: qty 0 + flag = red/white, qty 0 no flag = grey/white
- [x] Clear flag on restock (any transition 0 → >0: case/pack/manual +)
- [x] Clearing is separate from disable/delete — Remove on Restock screen only sets flag = 0; catalog row stays enabled

**Restock screen `#/restock`:**
- [x] Nav/menu entry “Restock”
- [x] List flagged cocktails + rimmers (name/thumb)
- [x] Per item: **Remove** (clear restock flag), **Add to Wishlist** button
- [x] Bartesian arrow link like Wishlist
- [x] Empty state (“Nothing to restock”)

**Import / export / seed:**
- [x] Persist `restock` flag through export (`.txt` `Restock: 0/1`) and `import-data.js` → seed
- [x] Seed-rev apply syncs `restock` flag like quantities

### Activity history (chronological)

Unified timeline of household cocktail activity — not just raw `inventory_log` rows. Per-item History page shows newest→oldest for that cocktail/rimmer.

**Events to capture (at write time):**
- [x] Capsule / rimmer used (qty −1 from scan confirm or Use 1)
- [x] Capsules / packs / cases added (restock +N, variety pack expand, manual ±)
- [x] Feedback added or updated (rating stars + optional comment, by person)
- [x] Favorited / unfavorited
- [x] Barcode associations saved (kind + code logged)

**Storage (exportable):**
- [x] `activity_log`: `id`, `created_at` (ISO), `kind` (`use` | `restock` | `rating` | `favorite` | `barcode` | `wishlist_*` | `restock_clear`), `cocktail_id` / `rimmer_id` / `pack_id` / `person_id` nullable, `delta`, `stars`, `detail`, `barcode`
- [x] Write an activity row whenever the corresponding action succeeds (with the inventory/rating persist)
- [x] Query API: `listActivity({ limit, cocktailId, rimmerId })` ordered by `created_at DESC, id DESC`

**UI:**
- [x] Per-item history only (no global menu entry): History link on cocktail/rimmer detail → `#/history/cocktail/:id` / `#/history/rimmer/:id` chronological feed, local datetime
- [x] Back link from item History → item detail
- [x] Empty state when no events yet

**Import / export:**
- [x] Include `activity.json` in export zip
- [x] `exportSnapshot()` + Settings export write full activity history
- [x] `import-data.js` / zip merge: restore activity into DB on import (seed + seed-rev merge, deduped by timestamp/kind/item/detail)
- [x] Reset local DB clears activity unless it was exported and re-imported (Settings copy / history data is seed-restored)

### Polish

- [ ] Favorites UX polish
- [ ] Full export parity (ratings/people/activity round-trip into seed or export zip)
- [x] Cocktail detail iconography for garnish / pairs-with (book-style circular marks)
- [x] Keep site private (no public marketing; access gate / robots as desired)
- [x] Enable GitHub Pages from repo root and smoke on a real `*.github.io` URL (private household use)

### Design notes

Visual direction: white background, black type, teal accent (`#00a8c5`), boxed brand mark, uppercase section labels, generous whitespace — inspired by cocktail-book spreads and bartesian.com product pages. Not dark mode.

## Hosting notes

GitHub Pages cannot write a shared SQLite file for all visitors. Canonical data stays in git; each browser keeps a local IndexedDB copy until an admin exports and pushes.
