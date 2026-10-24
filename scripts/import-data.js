/**
 * Build js/seed-data.js from data/cocktails|packs|rimmers .txt files.
 *
 * Usage:
 *   node scripts/import-data.js
 *       Merge exports/bartesian-exports.zip into data/ (by slug, preserving
 *       canonical filenames), remove duplicate-slug orphans, then rebuild seed.
 *
 *   node scripts/import-data.js --from-data
 *       Dedupe data/ orphans if needed, then rebuild seed (skip zip).
 *
 *   node scripts/import-data.js path/to/other.zip
 *       Merge a different zip, then rebuild seed.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const COCKTAILS_DIR = path.join(DATA_DIR, "cocktails");
const PACKS_DIR = path.join(DATA_DIR, "packs");
const RIMMERS_DIR = path.join(DATA_DIR, "rimmers");
const DEFAULT_ZIP = path.join(ROOT, "exports", "bartesian-exports.zip");
const OUT = path.join(ROOT, "js", "seed-data.js");

const COCKTAIL_KEYS = {
  Name: "name",
  Slug: "slug",
  Description: "description",
  Details: "details",
  Spirits: "spirits",
  Glassware: "glassware",
  Garnish: "garnish",
  "Pairs With": "pairs_with",
  Nutrition: "nutrition_json",
  Alcohol: "alcohol_json",
  "Bartesian URL": "bartesian_url",
  "Help URL": "help_url",
  "Shopify Product ID": "shopify_product_id",
  "Shopify Variant ID": "shopify_variant_id",
  "Shopify Handle": "shopify_handle",
  "Shopify SKU": "shopify_sku",
  "Gorgias Article ID": "gorgias_article_id",
  Image: "image",
  "Hero Image": "hero_image",
  "Marketing Image": "marketing_image",
  "Image Cut": "image_cut",
  Seasonal: "seasonal",
  Enabled: "enabled",
  Favorite: "favorite",
  Quantity: "quantity",
  "Capsule Barcode": "capsule_barcode",
  "Case Barcode": "case_barcode",
  "Case Qty": "case_qty",
  Restock: "restock",
};

const PACK_KEYS = {
  Name: "name",
  Slug: "slug",
  Barcode: "barcode",
  Notes: "notes",
  Image: "image",
  "Nutrition Image": "nutrition_image",
  "Bartesian URL": "bartesian_url",
  "Help URL": "help_url",
  "Shopify Product ID": "shopify_product_id",
  "Shopify Variant ID": "shopify_variant_id",
  "Shopify Handle": "shopify_handle",
  "Gorgias Article ID": "gorgias_article_id",
  Enabled: "enabled",
};

const RIMMER_KEYS = {
  Name: "name",
  Slug: "slug",
  Description: "description",
  Kind: "kind",
  "Pairs With": "pairs_with",
  "Cocktail Slugs": "cocktail_slugs",
  "Bartesian URL": "bartesian_url",
  "Help URL": "help_url",
  "Shopify Product ID": "shopify_product_id",
  "Shopify Variant ID": "shopify_variant_id",
  "Shopify Handle": "shopify_handle",
  "Gorgias Article ID": "gorgias_article_id",
  Image: "image",
  "Nutrition Image": "nutrition_image",
  Barcode: "barcode",
  Quantity: "quantity",
  Restock: "restock",
  Favorite: "favorite",
  Enabled: "enabled",
};

function stripIndent(line) {
  return line.replace(/^\t+/, "").replace(/^ {2,}/, "");
}

function parseBoolish(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return 0;
  return s === "1" || s === "true" || s === "yes" ? 1 : 0;
}

function parseMaybeJson(rest) {
  const t = String(rest || "").trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(t));
    } catch (_) {
      return t;
    }
  }
  return t;
}

function parseCocktailText(raw, filename) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cocktail = {
    name: "",
    slug: "",
    description: "",
    details: "",
    spirits: [],
    glassware: "",
    garnish: "",
    pairs_with: "",
    nutrition_json: "",
    alcohol_json: "",
    bartesian_url: "",
    help_url: "",
    image: "",
    hero_image: "",
    marketing_image: "",
    image_cut: "NA",
    seasonal: 0,
    enabled: 1,
    favorite: 0,
    quantity: 0,
    restock: 0,
    capsule_barcode: "",
    case_barcode: "",
    case_qty: 8,
    shopify_product_id: "",
    shopify_variant_id: "",
    shopify_handle: "",
    shopify_sku: "",
    gorgias_article_id: "",
    _file: filename,
  };

  for (const line of lines) {
    const header = line.match(/^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$/);
    if (!header) continue;
    const key = header[1];
    const rest = (header[2] || "").trim();
    const mapped = COCKTAIL_KEYS[key];
    if (!mapped) continue;
    if (mapped === "spirits") {
      cocktail.spirits = rest
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (mapped === "favorite" || mapped === "seasonal" || mapped === "enabled" || mapped === "restock") {
      cocktail[mapped] = parseBoolish(rest);
    } else if (mapped === "quantity" || mapped === "case_qty") {
      cocktail[mapped] = Number(rest) || 0;
    } else if (mapped === "nutrition_json" || mapped === "alcohol_json") {
      cocktail[mapped] = parseMaybeJson(rest);
    } else if (mapped === "details") {
      cocktail.details = rest.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    } else if (mapped === "image_cut") {
      const cut = rest.trim().toLowerCase();
      cocktail.image_cut = cut === "left" ? "Left" : cut === "right" ? "Right" : "NA";
    } else {
      cocktail[mapped] = rest;
    }
  }

  if (!cocktail.image) {
    cocktail.image = cocktail.hero_image || cocktail.marketing_image || "";
  }

  if (!cocktail.slug && cocktail.name) {
    cocktail.slug = cocktail.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  return cocktail;
}

function parsePackText(raw, filename) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const pack = {
    name: "",
    slug: "",
    barcode: "",
    notes: "",
    image: "",
    nutrition_image: "",
    bartesian_url: "",
    help_url: "",
    shopify_product_id: "",
    shopify_variant_id: "",
    shopify_handle: "",
    gorgias_article_id: "",
    enabled: 1,
    items: [],
    _file: filename,
  };

  let mode = "headers";
  for (const line of lines) {
    if (/^Items:[ \t]*/.test(line)) {
      mode = "items";
      continue;
    }
    if (mode === "headers") {
      const header = line.match(/^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$/);
      if (!header) continue;
      const mapped = PACK_KEYS[header[1]];
      if (!mapped) continue;
      const rest = (header[2] || "").trim();
      if (mapped === "enabled") pack.enabled = parseBoolish(rest);
      else pack[mapped] = rest;
      continue;
    }
    const body = stripIndent(line).trim();
    if (!body) continue;
    const m = body.match(/^([^:]+):\s*(\d+)\s*$/);
    if (m) {
      pack.items.push({ cocktail_slug: m[1].trim(), qty: Number(m[2]) });
    }
  }

  if (!pack.slug && pack.name) {
    pack.slug = pack.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  return pack;
}

function parseRimmerText(raw, filename) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rimmer = {
    name: "",
    slug: "",
    description: "",
    kind: "",
    pairs_with: "",
    cocktail_slugs: [],
    bartesian_url: "",
    help_url: "",
    image: "",
    nutrition_image: "",
    barcode: "",
    quantity: 0,
    restock: 0,
    favorite: 0,
    enabled: 1,
    shopify_product_id: "",
    shopify_variant_id: "",
    shopify_handle: "",
    gorgias_article_id: "",
    _file: filename,
  };

  for (const line of lines) {
    const header = line.match(/^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$/);
    if (!header) continue;
    const mapped = RIMMER_KEYS[header[1]];
    if (!mapped) continue;
    const rest = (header[2] || "").trim();
    if (mapped === "cocktail_slugs") {
      rimmer.cocktail_slugs = rest
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (mapped === "favorite" || mapped === "enabled" || mapped === "restock") {
      rimmer[mapped] = parseBoolish(rest);
    } else if (mapped === "quantity") {
      rimmer.quantity = Number(rest) || 0;
    } else {
      rimmer[mapped] = rest;
    }
  }

  if (!rimmer.slug && rimmer.name) {
    rimmer.slug = rimmer.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  return rimmer;
}

function readDirTxt(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const absZip = path.resolve(zipPath);
  try {
    execFileSync("tar", ["-xf", absZip, "-C", destDir], { stdio: "pipe" });
    return;
  } catch (_) {
    /* fall through */
  }
  if (process.platform === "win32") {
    const psZip = absZip.replace(/'/g, "''");
    const psDest = destDir.replace(/'/g, "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psDest}' -Force`,
      ],
      { stdio: "pipe" }
    );
    return;
  }
  execFileSync("unzip", ["-o", absZip, "-d", destDir], { stdio: "pipe" });
}

function findExportRoot(extractedDir) {
  const candidates = [extractedDir, path.join(extractedDir, "exports"), path.join(extractedDir, "data")];
  for (const ent of fs.readdirSync(extractedDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      candidates.push(path.join(extractedDir, ent.name));
      candidates.push(path.join(extractedDir, ent.name, "exports"));
    }
  }
  for (const base of candidates) {
    if (
      fs.existsSync(path.join(base, "cocktails")) ||
      fs.existsSync(path.join(base, "packs")) ||
      fs.existsSync(path.join(base, "rimmers"))
    ) {
      return base;
    }
  }
  return null;
}

/** Filename-only tie-break: regional / longer / less-mangled. */
function preferFilename(a, b) {
  const score = (f) => {
    let s = f.length;
    if (/(EUUK|UKOnly|USOnly)\.txt$/i.test(f)) s += 100;
    if (/^thHole\.txt$/i.test(f)) s -= 80;
    if (/CafCito/i.test(f)) s -= 40;
    if (/JalapeO|JollypeO/i.test(f)) s -= 40;
    if (/WinterPearAdise/i.test(f)) s -= 20;
    return s;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa >= sb ? a : b;
  return a.localeCompare(b, undefined, { sensitivity: "base" }) <= 0 ? a : b;
}

/**
 * Prefer the richer on-disk variant for a slug (more pack items, real image_cut,
 * not a redundant *Rimmer.txt twin), then fall back to preferFilename.
 */
function preferFileInDir(dir, a, b, parseFn) {
  const stem = (f) => f.replace(/\.txt$/i, "");
  if (stem(a) + "Rimmer" === stem(b)) return a;
  if (stem(b) + "Rimmer" === stem(a)) return b;

  const meta = (f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const item = parseFn(raw, f);
    const items = Array.isArray(item.items) ? item.items.length : 0;
    const cut = item.image_cut && item.image_cut !== "NA" ? 1 : 0;
    const img = item.image ? 1 : 0;
    return { rawLen: raw.length, items, cut, img };
  };
  const A = meta(a);
  const B = meta(b);
  if (A.items !== B.items) return A.items >= B.items ? a : b;
  if (A.cut !== B.cut) return A.cut >= B.cut ? a : b;
  if (A.img !== B.img) return A.img >= B.img ? a : b;
  if (Math.abs(A.rawLen - B.rawLen) > 40) return A.rawLen >= B.rawLen ? a : b;
  return preferFilename(a, b);
}

function slugFromTxt(raw, parseFn, filename) {
  const item = parseFn(raw, filename);
  return item && item.slug ? item.slug : "";
}

/** Map slug → preferred existing filename in destDir. */
function indexSlugToFile(destDir, parseFn) {
  const bySlug = new Map();
  for (const f of readDirTxt(destDir)) {
    const raw = fs.readFileSync(path.join(destDir, f), "utf8");
    const slug = slugFromTxt(raw, parseFn, f);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, f);
    else bySlug.set(slug, preferFileInDir(destDir, bySlug.get(slug), f, parseFn));
  }
  return bySlug;
}

/**
 * Write export .txt files into dest by slug: overwrite the existing canonical
 * filename when the slug is already present (avoids thHole.txt vs 19thHole.txt).
 * Then delete any remaining same-slug orphans.
 */
function mergeTxtDirBySlug(srcDir, destDir, parseFn, kind) {
  if (!fs.existsSync(srcDir)) return { written: 0, updated: 0, created: 0, removed: 0 };
  fs.mkdirSync(destDir, { recursive: true });
  const slugToFile = indexSlugToFile(destDir, parseFn);
  let updated = 0;
  let created = 0;
  for (const f of readDirTxt(srcDir)) {
    const srcPath = path.join(srcDir, f);
    const raw = fs.readFileSync(srcPath, "utf8");
    const slug = slugFromTxt(raw, parseFn, f);
    const destName = (slug && slugToFile.get(slug)) || f;
    const destPath = path.join(destDir, destName);
    const existed = slug && slugToFile.has(slug);
    fs.writeFileSync(destPath, raw, "utf8");
    if (existed) {
      updated++;
      if (destName !== f) {
        console.log(`Updated ${kind} ${destName} ← export ${f} (slug ${slug})`);
      }
    } else {
      created++;
      if (slug) slugToFile.set(slug, destName);
    }
  }
  const removed = removeDuplicateSlugFiles(destDir, parseFn, kind, slugToFile);
  return { written: updated + created, updated, created, removed };
}

/** Delete extra .txt files that share a slug; keep the preferred / mapped name. */
function removeDuplicateSlugFiles(dir, parseFn, kind, preferredBySlug) {
  if (!fs.existsSync(dir)) return 0;
  const groups = new Map();
  for (const f of readDirTxt(dir)) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const slug = slugFromTxt(raw, parseFn, f);
    if (!slug) continue;
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(f);
  }
  let removed = 0;
  for (const [slug, files] of groups) {
    if (files.length < 2) continue;
    let keep = preferredBySlug && preferredBySlug.get(slug);
    if (!keep || !files.includes(keep)) {
      keep = files.reduce((a, b) => preferFileInDir(dir, a, b, parseFn));
    }
    for (const f of files) {
      if (f === keep) continue;
      fs.unlinkSync(path.join(dir, f));
      console.warn(`Removed duplicate ${kind} ${f} (kept ${keep}, slug "${slug}")`);
      removed++;
    }
  }
  return removed;
}

function dedupeDataDirs() {
  const c = removeDuplicateSlugFiles(COCKTAILS_DIR, parseCocktailText, "cocktail");
  const p = removeDuplicateSlugFiles(PACKS_DIR, parsePackText, "pack");
  const r = removeDuplicateSlugFiles(RIMMERS_DIR, parseRimmerText, "rimmer");
  if (c + p + r > 0) {
    console.log(`Deduped data/: removed ${c} cocktail, ${p} pack, ${r} rimmer orphan(s)`);
  }
  return { c, p, r };
}

function mergeZipIntoData(zipPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bartesian-import-"));
  try {
    console.log("Extracting", path.relative(process.cwd(), zipPath) || zipPath, "…");
    extractZip(zipPath, tempDir);
    const base = findExportRoot(tempDir);
    if (!base) {
      throw new Error("Zip has no cocktails/, packs/, or rimmers/ folder");
    }
    const c = mergeTxtDirBySlug(path.join(base, "cocktails"), COCKTAILS_DIR, parseCocktailText, "cocktail");
    const p = mergeTxtDirBySlug(path.join(base, "packs"), PACKS_DIR, parsePackText, "pack");
    const r = mergeTxtDirBySlug(path.join(base, "rimmers"), RIMMERS_DIR, parseRimmerText, "rimmer");
    for (const name of ["barcodes.json", "ratings.json", "people.json", "activity.json", "wishlist.json"]) {
      const src = path.join(base, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(DATA_DIR, name));
        console.log("Copied", name);
      }
    }
    console.log(
      `Merged into data/: cocktails ${c.updated} updated/${c.created} new (${c.removed} dupes removed), ` +
        `packs ${p.updated}/${p.created} (${p.removed} dupes), ` +
        `rimmers ${r.updated}/${r.created} (${r.removed} dupes)`
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** Safety net if on-disk dupes remain; preferFilename order matches removeDuplicateSlugFiles. */
function dedupeBySlug(items, kind) {
  const best = new Map();
  for (const item of items) {
    if (!item.slug) continue;
    const prev = best.get(item.slug);
    if (!prev) {
      best.set(item.slug, item);
      continue;
    }
    const keepName = preferFilename(prev._file || "", item._file || "");
    if (keepName === item._file) {
      console.warn(`Skipping duplicate ${kind} slug "${item.slug}" from ${prev._file} (kept ${item._file})`);
      best.set(item.slug, item);
    } else {
      console.warn(`Skipping duplicate ${kind} slug "${item.slug}" from ${item._file} (kept ${prev._file})`);
    }
  }
  return [...best.values()].sort((a, b) =>
    String(a._file || "").localeCompare(String(b._file || ""), undefined, { sensitivity: "base" })
  );
}

function writeSeed() {
  dedupeDataDirs();
  const cocktails = dedupeBySlug(
    readDirTxt(COCKTAILS_DIR).map((f) =>
      parseCocktailText(fs.readFileSync(path.join(COCKTAILS_DIR, f), "utf8"), f)
    ),
    "cocktail"
  );
  const packs = dedupeBySlug(
    readDirTxt(PACKS_DIR).map((f) =>
      parsePackText(fs.readFileSync(path.join(PACKS_DIR, f), "utf8"), f)
    ),
    "pack"
  );
  const rimmers = dedupeBySlug(
    readDirTxt(RIMMERS_DIR).map((f) =>
      parseRimmerText(fs.readFileSync(path.join(RIMMERS_DIR, f), "utf8"), f)
    ),
    "rimmer"
  );
  const peopleJson = readJsonIfExists(path.join(DATA_DIR, "people.json"));
  const people = peopleJson.length
    ? peopleJson
        .map((p) => ({ name: p.name, is_admin: p.is_admin ? 1 : 0 }))
        .filter((p) => p.name)
    : [{ name: "Lawrence", is_admin: 1 }];
  const activity = readJsonIfExists(path.join(DATA_DIR, "activity.json"));
  const wishlist = readJsonIfExists(path.join(DATA_DIR, "wishlist.json"));
  // Bump on every import so the browser applies seed quantities into IndexedDB.
  const rev = new Date().toISOString();
  const out = `/* Auto-generated by scripts/import-data.js — do not edit by hand */
window.BARTESIAN_SEED_REV = ${JSON.stringify(rev)};
window.BARTESIAN_SEED = ${JSON.stringify({ people, cocktails, packs, rimmers, activity, wishlist }, null, 2)};
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, "utf8");
  console.log(
    `Wrote ${cocktails.length} cocktails, ${packs.length} packs, ${rimmers.length} rimmers → ${path.relative(ROOT, OUT)} (rev ${rev})`
  );
}

function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(`Usage:
  node scripts/import-data.js
      Merge exports/bartesian-exports.zip → data/ by slug (keeps canonical
      filenames, removes duplicate-slug orphans), then rebuild seed.
  node scripts/import-data.js --from-data
      Dedupe data/ if needed, then rebuild seed (skip zip).
  node scripts/import-data.js path/to/other.zip
      Merge a different zip, then rebuild seed.

Copy the app export zip to:
  ${path.relative(ROOT, DEFAULT_ZIP)}`);
    return;
  }

  if (arg === "--from-data") {
    writeSeed();
    return;
  }

  const zipPath = arg ? path.resolve(arg) : DEFAULT_ZIP;
  if (arg && !/\.zip$/i.test(arg)) {
    console.error("Pass a .zip file, --from-data, or no args. Got:", arg);
    process.exit(1);
  }
  if (!fs.existsSync(zipPath)) {
    console.error(
      "Zip not found:",
      path.relative(ROOT, zipPath) || zipPath,
      "\nCopy bartesian-exports.zip into exports/ then re-run."
    );
    process.exit(1);
  }
  mergeZipIntoData(zipPath);
  writeSeed();
}

main();
