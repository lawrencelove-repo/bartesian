/**
 * Parse data/cocktails/*.txt, data/packs/*.txt, data/rimmers/*.txt into js/seed-data.js.
 * Run: node scripts/import-data.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const COCKTAILS_DIR = path.join(ROOT, "data", "cocktails");
const PACKS_DIR = path.join(ROOT, "data", "packs");
const RIMMERS_DIR = path.join(ROOT, "data", "rimmers");
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
    } else if (mapped === "favorite" || mapped === "seasonal" || mapped === "enabled") {
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
    } else if (mapped === "favorite" || mapped === "enabled") {
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

function main() {
  const cocktails = readDirTxt(COCKTAILS_DIR).map((f) =>
    parseCocktailText(fs.readFileSync(path.join(COCKTAILS_DIR, f), "utf8"), f)
  );
  const packs = readDirTxt(PACKS_DIR).map((f) =>
    parsePackText(fs.readFileSync(path.join(PACKS_DIR, f), "utf8"), f)
  );
  const rimmers = readDirTxt(RIMMERS_DIR).map((f) =>
    parseRimmerText(fs.readFileSync(path.join(RIMMERS_DIR, f), "utf8"), f)
  );

  const people = [{ name: "Me" }];

  const out = `/* Auto-generated by scripts/import-data.js — do not edit by hand */
window.BARTESIAN_SEED = ${JSON.stringify({ people, cocktails, packs, rimmers }, null, 2)};
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, "utf8");
  console.log(
    `Wrote ${cocktails.length} cocktails, ${packs.length} packs, ${rimmers.length} rimmers → ${path.relative(ROOT, OUT)}`
  );
}

main();
