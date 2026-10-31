/**
 * Generate a deterministic D1 seed import from js/seed-data.js (+ data/*.json extras).
 * Usage: node scripts/generate-d1-seed.cjs
 * Writes seeds/bartesian_seed.sql (separate from Wrangler schema migrations).
 * Import only into an empty bartesian-db. Do not re-run after live edits.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const seedSource = fs.readFileSync(path.join(root, "js/seed-data.js"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(seedSource, sandbox, { timeout: 10000, filename: "seed-data.js" });
const seed = sandbox.window.BARTESIAN_SEED;
if (!seed || !Array.isArray(seed.cocktails)) throw new Error("BARTESIAN_SEED missing");

function readJson(name, fallback) {
  const p = path.join(root, "data", name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const peopleFile = readJson("people.json", []);
const ratingsFile = readJson("ratings.json", []);
const barcodesFile = readJson("barcodes.json", []);
const bookFile = seed.book || readJson("book.json", { version: 1, globals: {}, cocktails: {} });

const sqlValue = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? Number.isFinite(v)
        ? String(v)
        : "NULL"
      : "'" + String(v).replace(/'/g, "''") + "'";

function insert(table, columns, values) {
  statements.push(
    "INSERT INTO " +
      table +
      " (" +
      columns.join(", ") +
      ") VALUES (" +
      values.map(sqlValue).join(", ") +
      ");"
  );
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function jsonField(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return "";
  }
}

function normalizeImageCut(v) {
  const s = String(v || "NA").toUpperCase();
  return ["NA", "LEFT", "RIGHT", "CENTER"].includes(s) ? s : "NA";
}

const timestamp = "2026-10-31T00:00:00.000Z";
const statements = [
  "-- Generated from js/seed-data.js and data/*.json. Import only into empty D1.",
  "-- Do not replay on a database that already contains live inventory edits.",
  "PRAGMA foreign_keys = ON;",
  "DELETE FROM meta WHERE key = 'seed_imported_at';",
];

const spiritIds = {};
let spiritId = 0;
let personId = 0;
let cocktailId = 0;
let rimmerId = 0;
let packId = 0;
let barcodeId = 0;
let ratingId = 0;
let activityId = 0;
let wishlistId = 0;

const seenBarcodeCodes = new Set();
const personByName = {};
const peopleSource =
  Array.isArray(peopleFile) && peopleFile.length
    ? peopleFile
    : seed.people || [];

for (const person of peopleSource) {
  if (!person || !person.name) continue;
  const name = String(person.name).trim();
  if (!name || personByName[name]) continue;
  const id = person.id != null ? Number(person.id) : ++personId;
  personId = Math.max(personId, id);
  personByName[name] = id;
  insert(
    "people",
    ["id", "name", "is_admin", "created_at"],
    [id, name, person.is_admin ? 1 : 0, person.created_at || timestamp]
  );
}

const cocktailBySlug = {};
for (const c of seed.cocktails || []) {
  if (!c.slug || !c.name || cocktailBySlug[c.slug]) continue;
  const id = ++cocktailId;
  cocktailBySlug[c.slug] = id;
  const hero = c.hero_image || "";
  const marketing = c.marketing_image || "";
  insert(
    "cocktails",
    [
      "id",
      "slug",
      "name",
      "description",
      "details",
      "image",
      "hero_image",
      "marketing_image",
      "image_cut",
      "glassware",
      "garnish",
      "pairs_with",
      "nutrition_json",
      "alcohol_json",
      "bartesian_url",
      "help_url",
      "shopify_product_id",
      "shopify_variant_id",
      "shopify_handle",
      "shopify_sku",
      "gorgias_article_id",
      "seasonal",
      "favorite",
      "enabled",
      "quantity",
      "restock",
      "created_at",
      "updated_at",
    ],
    [
      id,
      c.slug,
      c.name,
      c.description || "",
      c.details || "",
      c.image || hero || marketing || "",
      hero,
      marketing,
      normalizeImageCut(c.image_cut),
      c.glassware || "",
      c.garnish || "",
      c.pairs_with || "",
      jsonField(c.nutrition_json),
      jsonField(c.alcohol_json),
      c.bartesian_url || "",
      c.help_url || "",
      c.shopify_product_id || "",
      c.shopify_variant_id || "",
      c.shopify_handle || "",
      c.shopify_sku || "",
      c.gorgias_article_id || "",
      c.seasonal ? 1 : 0,
      c.favorite ? 1 : 0,
      c.enabled === 0 || c.enabled === false ? 0 : 1,
      Number(c.quantity) || 0,
      c.restock ? 1 : 0,
      timestamp,
      timestamp,
    ]
  );

  const spirits = Array.isArray(c.spirits)
    ? c.spirits
    : String(c.spirits || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  spirits.forEach((name, sortOrder) => {
    const spiritName = String(name).trim();
    if (!spiritName) return;
    if (!spiritIds[spiritName]) {
      spiritIds[spiritName] = ++spiritId;
      insert("spirits", ["id", "name"], [spiritIds[spiritName], spiritName]);
    }
    insert(
      "cocktail_spirits",
      ["cocktail_id", "spirit_id", "sort_order"],
      [id, spiritIds[spiritName], sortOrder]
    );
  });

  if (c.capsule_barcode) {
    const code = String(c.capsule_barcode);
    seenBarcodeCodes.add(code);
    insert(
      "barcodes",
      ["id", "code", "kind", "cocktail_id", "pack_id", "rimmer_id", "case_qty"],
      [++barcodeId, code, "capsule", id, null, null, 1]
    );
  }
  if (c.case_barcode) {
    const code = String(c.case_barcode);
    seenBarcodeCodes.add(code);
    insert(
      "barcodes",
      ["id", "code", "kind", "cocktail_id", "pack_id", "rimmer_id", "case_qty"],
      [++barcodeId, code, "case", id, null, null, Number(c.case_qty) || 8]
    );
  }
}

const rimmerBySlug = {};
for (const r of seed.rimmers || []) {
  if (!r.slug || !r.name || rimmerBySlug[r.slug]) continue;
  const id = ++rimmerId;
  rimmerBySlug[r.slug] = id;
  insert(
    "rimmers",
    [
      "id",
      "slug",
      "name",
      "description",
      "image",
      "kind",
      "pairs_with",
      "nutrition_image",
      "bartesian_url",
      "help_url",
      "shopify_product_id",
      "shopify_variant_id",
      "shopify_handle",
      "gorgias_article_id",
      "favorite",
      "enabled",
      "quantity",
      "restock",
      "created_at",
      "updated_at",
    ],
    [
      id,
      r.slug,
      r.name,
      r.description || "",
      r.image || "",
      r.kind || "",
      r.pairs_with || "",
      r.nutrition_image || "",
      r.bartesian_url || "",
      r.help_url || "",
      r.shopify_product_id || "",
      r.shopify_variant_id || "",
      r.shopify_handle || "",
      r.gorgias_article_id || "",
      r.favorite ? 1 : 0,
      r.enabled === 0 || r.enabled === false ? 0 : 1,
      Number(r.quantity) || 0,
      r.restock ? 1 : 0,
      timestamp,
      timestamp,
    ]
  );
  const slugs = r.cocktail_slugs || r.pair_slugs || [];
  (Array.isArray(slugs) ? slugs : String(slugs).split(",").map((s) => s.trim()).filter(Boolean)).forEach(
    (slug) => {
      const cid = cocktailBySlug[slug];
      if (!cid) return;
      insert("cocktail_rimmers", ["cocktail_id", "rimmer_id"], [cid, id]);
    }
  );
  if (r.barcode) {
    const code = String(r.barcode);
    seenBarcodeCodes.add(code);
    insert(
      "barcodes",
      ["id", "code", "kind", "cocktail_id", "pack_id", "rimmer_id", "case_qty"],
      [++barcodeId, code, "rimmer", null, null, id, 1]
    );
  }
}

const packBySlug = {};
for (const p of seed.packs || []) {
  if (!p.slug || !p.name || packBySlug[p.slug]) continue;
  const id = ++packId;
  packBySlug[p.slug] = id;
  insert(
    "packs",
    [
      "id",
      "slug",
      "name",
      "notes",
      "image",
      "nutrition_image",
      "bartesian_url",
      "help_url",
      "shopify_product_id",
      "shopify_variant_id",
      "shopify_handle",
      "gorgias_article_id",
      "enabled",
      "created_at",
      "updated_at",
    ],
    [
      id,
      p.slug,
      p.name,
      p.notes || "",
      p.image || "",
      p.nutrition_image || "",
      p.bartesian_url || "",
      p.help_url || "",
      p.shopify_product_id || "",
      p.shopify_variant_id || "",
      p.shopify_handle || "",
      p.gorgias_article_id || "",
      p.enabled === 0 || p.enabled === false ? 0 : 1,
      timestamp,
      timestamp,
    ]
  );
  (p.items || []).forEach((item) => {
    const cid = cocktailBySlug[item.cocktail_slug];
    if (!cid) return;
    insert(
      "pack_items",
      ["pack_id", "cocktail_id", "qty"],
      [id, cid, Number(item.qty) || 1]
    );
  });
  if (p.barcode) {
    const code = String(p.barcode);
    seenBarcodeCodes.add(code);
    insert(
      "barcodes",
      ["id", "code", "kind", "cocktail_id", "pack_id", "rimmer_id", "case_qty"],
      [++barcodeId, code, "variety_pack", null, id, null, 0]
    );
  }
}

for (const b of barcodesFile || []) {
  const code = String(b.code || "").trim();
  if (!code || seenBarcodeCodes.has(code)) continue;
  seenBarcodeCodes.add(code);
  const cid = b.cocktail_slug ? cocktailBySlug[b.cocktail_slug] : b.cocktail_id || null;
  const pid = b.pack_slug ? packBySlug[b.pack_slug] : b.pack_id || null;
  const rid = b.rimmer_slug ? rimmerBySlug[b.rimmer_slug] : b.rimmer_id || null;
  insert(
    "barcodes",
    ["id", "code", "kind", "cocktail_id", "pack_id", "rimmer_id", "case_qty"],
    [
      ++barcodeId,
      code,
      b.kind || "capsule",
      cid || null,
      pid || null,
      rid || null,
      Number(b.case_qty) || 8,
    ]
  );
}

for (const r of ratingsFile || []) {
  const cid = r.cocktail_slug ? cocktailBySlug[r.cocktail_slug] : r.cocktail_id;
  const pid = r.person_name ? personByName[r.person_name] : r.person_id;
  if (!cid || !pid) continue;
  insert(
    "ratings",
    ["id", "cocktail_id", "person_id", "stars", "comment", "created_at", "updated_at"],
    [
      ++ratingId,
      cid,
      pid,
      Math.max(1, Math.min(5, Number(r.stars) || 1)),
      r.comment || "",
      r.created_at || timestamp,
      r.updated_at || r.created_at || timestamp,
    ]
  );
}

for (const w of seed.wishlist || []) {
  const cid = w.cocktail_slug ? cocktailBySlug[w.cocktail_slug] : null;
  const rid = w.rimmer_slug ? rimmerBySlug[w.rimmer_slug] : null;
  if (!cid && !rid) continue;
  insert(
    "wishlist_items",
    ["id", "cocktail_id", "rimmer_id", "qty_wanted", "created_at", "updated_at"],
    [
      ++wishlistId,
      cid || null,
      rid || null,
      Math.max(1, Number(w.qty_wanted) || 1),
      w.created_at || timestamp,
      w.updated_at || w.created_at || timestamp,
    ]
  );
}

for (const a of seed.activity || []) {
  const packSlug = a.pack_slug || "";
  const pid = packSlug && packSlug !== "fill_me" ? packBySlug[packSlug] || null : null;
  insert(
    "activity_log",
    [
      "id",
      "created_at",
      "kind",
      "cocktail_id",
      "rimmer_id",
      "pack_id",
      "person_id",
      "delta",
      "stars",
      "detail",
      "barcode",
      "logged_pack_name",
      "logged_pack_slug",
    ],
    [
      ++activityId,
      a.created_at || timestamp,
      a.kind || "event",
      a.cocktail_slug ? cocktailBySlug[a.cocktail_slug] || null : null,
      a.rimmer_slug ? rimmerBySlug[a.rimmer_slug] || null : null,
      pid,
      a.person_name ? personByName[a.person_name] || null : null,
      a.delta != null ? Number(a.delta) : null,
      a.stars != null ? Number(a.stars) : null,
      a.detail || "",
      a.barcode || "",
      a.pack_name || "",
      packSlug,
    ]
  );
}

const globals = bookFile.globals || {};
for (const [form, orients] of Object.entries(globals)) {
  for (const [orient, layout] of Object.entries(orients || {})) {
    insert(
      "book_globals",
      ["form_factor", "orientation", "x", "y", "scale", "updated_at"],
      [
        form,
        orient,
        Number(layout.x) || 0,
        Number(layout.y) || 0,
        Number(layout.scale) || 1,
        timestamp,
      ]
    );
  }
}

const bookCocktails = bookFile.cocktails || {};
for (const [slug, entry] of Object.entries(bookCocktails)) {
  const cid = cocktailBySlug[slug];
  if (!cid || !entry) continue;
  if (entry.image_cut) {
    insert(
      "book_cocktail_settings",
      ["cocktail_id", "image_cut", "updated_at"],
      [cid, normalizeImageCut(entry.image_cut), timestamp]
    );
  }
  for (const [form, orients] of Object.entries(entry.layouts || entry)) {
    if (form === "image_cut" || form === "layouts") continue;
    if (!orients || typeof orients !== "object") continue;
    for (const [orient, layout] of Object.entries(orients)) {
      if (!layout || typeof layout !== "object") continue;
      if (layout.x == null && layout.y == null && layout.scale == null) continue;
      insert(
        "book_cocktail_layouts",
        ["cocktail_id", "form_factor", "orientation", "x", "y", "scale", "updated_at"],
        [
          cid,
          form,
          orient,
          Number(layout.x) || 0,
          Number(layout.y) || 0,
          Number(layout.scale) || 1,
          timestamp,
        ]
      );
    }
  }
}

// Use REPLACE so seed is safe after 0001_schema's INSERT OR IGNORE of schema_version.
statements.push(
  "INSERT OR REPLACE INTO meta (key, value) VALUES (" +
    sqlValue("seed_imported_at") +
    ", " +
    sqlValue(timestamp) +
    ");"
);
statements.push(
  "INSERT OR REPLACE INTO meta (key, value) VALUES (" +
    sqlValue("schema_version") +
    ", " +
    sqlValue("9") +
    ");"
);

const seedsDir = path.join(root, "seeds");
fs.mkdirSync(seedsDir, { recursive: true });
const target = path.join(seedsDir, "bartesian_seed.sql");
fs.writeFileSync(target, statements.join("\n") + "\n");

const summary = {
  people: Object.keys(personByName).length,
  spirits: Object.keys(spiritIds).length,
  cocktails: cocktailId,
  rimmers: rimmerId,
  packs: packId,
  barcodes: barcodeId,
  ratings: ratingId,
  activity: activityId,
  wishlist: wishlistId,
};
console.log("Generated D1 seed at", target);
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(seedsDir, "bartesian_seed_summary.json"),
  JSON.stringify(summary, null, 2) + "\n"
);
