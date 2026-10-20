/**
 * Build js/seed-data.js from data/cocktails|packs|rimmers .txt files.
 *
 * Usage:
 *   node scripts/import-data.js
 *       Merge exports/bartesian-exports.zip into data/, then rebuild seed.
 *
 *   node scripts/import-data.js --from-data
 *       Rebuild seed from data/ only (skip zip).
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

function copyTxtDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const f of readDirTxt(srcDir)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    n++;
  }
  return n;
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
    const c = copyTxtDir(path.join(base, "cocktails"), COCKTAILS_DIR);
    const p = copyTxtDir(path.join(base, "packs"), PACKS_DIR);
    const r = copyTxtDir(path.join(base, "rimmers"), RIMMERS_DIR);
    for (const name of ["barcodes.json", "ratings.json", "people.json", "activity.json", "wishlist.json"]) {
      const src = path.join(base, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(DATA_DIR, name));
        console.log("Copied", name);
      }
    }
    console.log(`Merged into data/: ${c} cocktails, ${p} packs, ${r} rimmers`);
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

/** Duplicate .txt files share slugs (EU/UK, US-only variants); first file wins. */
function dedupeBySlug(items, kind) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.slug) continue;
    if (seen.has(item.slug)) {
      console.warn(`Skipping duplicate ${kind} slug "${item.slug}" from ${item._file} (kept first)`);
      continue;
    }
    seen.add(item.slug);
    out.push(item);
  }
  return out;
}

function writeSeed() {
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
      Merge exports/bartesian-exports.zip → data/, then rebuild seed.
  node scripts/import-data.js --from-data
      Rebuild seed from data/ only.
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
