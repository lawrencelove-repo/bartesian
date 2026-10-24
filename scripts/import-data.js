/**
 * Build js/seed-data.js from data/cocktails|packs|rimmers .txt files.
 *
 * Usage:
 *   node scripts/import-data.js
 *       Merge zip into data/ by slug: inventory fields only on existing .txt;
 *       JSON merges without SQLite ids; then rebuild seed.
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

/** Inventory / barcode headers only — never rewrite catalog copy from an export. */
const INVENTORY_HEADERS = {
  cocktail: [
    "Quantity",
    "Restock",
    "Favorite",
    "Capsule Barcode",
    "Case Barcode",
    // Case Qty is catalog packaging size — not patched from live DB defaults
  ],
  pack: ["Barcode"],
  rimmer: ["Quantity", "Restock", "Favorite", "Barcode"],
};

function headerValuesFromTxt(raw) {
  const map = new Map();
  for (const line of String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$/);
    if (!m) continue;
    map.set(m[1], (m[2] || "").trim());
  }
  return map;
}

/** True when an incoming inventory value is worth inserting into a file that lacks the header. */
function meaningfulInventoryInsert(header, value) {
  const v = String(value ?? "").trim();
  if (header === "Restock" || header === "Favorite") return v === "1";
  if (header === "Quantity") return v !== "" && v !== "0";
  if (/Barcode/i.test(header)) return v.length > 0;
  return v.length > 0;
}

/**
 * Patch only inventory headers in an existing .txt, preserving field order and
 * catalog content. Updates existing lines in place. Inserts a missing header
 * only when the incoming value is meaningful (e.g. Restock: 1), never Restock: 0.
 */
function patchInventoryTxt(existingRaw, incomingRaw, kind) {
  const headers = INVENTORY_HEADERS[kind] || [];
  if (!headers.length) return { text: existingRaw, changed: false };
  const incoming = headerValuesFromTxt(incomingRaw);
  const updates = new Map();
  for (const h of headers) {
    if (incoming.has(h)) updates.set(h, incoming.get(h));
  }
  if (!updates.size) return { text: existingRaw, changed: false };

  const eol = existingRaw.includes("\r\n") ? "\r\n" : "\n";
  const lines = existingRaw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const seen = new Set();
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!updates.has(key)) continue;
    seen.add(key);
    const next = updates.get(key);
    const prev = (m[2] || "").trim();
    if (prev !== next) {
      lines[i] = key + ": " + next;
      changed = true;
    }
  }
  for (const h of headers) {
    if (seen.has(h) || !updates.has(h)) continue;
    if (!meaningfulInventoryInsert(h, updates.get(h))) continue;
    let insertAt = lines.length;
    while (insertAt > 0 && lines[insertAt - 1] === "") insertAt--;
    lines.splice(insertAt, 0, h + ": " + updates.get(h));
    changed = true;
  }
  if (!changed) return { text: existingRaw, changed: false };
  let text = lines.join("\n");
  if (eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  return { text, changed: true };
}

/**
 * Merge export .txt files into dest by slug.
 * Existing slugs: patch inventory/barcode fields only (keeps catalog text).
 * New slugs: write the full export file under the export filename.
 * Then delete any remaining same-slug orphans.
 */
function mergeTxtDirBySlug(srcDir, destDir, parseFn, kind) {
  if (!fs.existsSync(srcDir)) return { written: 0, updated: 0, created: 0, removed: 0, unchanged: 0 };
  fs.mkdirSync(destDir, { recursive: true });
  const slugToFile = indexSlugToFile(destDir, parseFn);
  let updated = 0;
  let created = 0;
  let unchanged = 0;
  for (const f of readDirTxt(srcDir)) {
    const srcPath = path.join(srcDir, f);
    const raw = fs.readFileSync(srcPath, "utf8");
    const slug = slugFromTxt(raw, parseFn, f);
    if (slug && slugToFile.has(slug)) {
      const destName = slugToFile.get(slug);
      const destPath = path.join(destDir, destName);
      const existingRaw = fs.readFileSync(destPath, "utf8");
      const patched = patchInventoryTxt(existingRaw, raw, kind);
      if (patched.changed) {
        fs.writeFileSync(destPath, patched.text, "utf8");
        updated++;
        if (destName !== f) {
          console.log(`Inventory-updated ${kind} ${destName} ← export ${f} (slug ${slug})`);
        }
      } else {
        unchanged++;
      }
    } else {
      const destName = f;
      fs.writeFileSync(path.join(destDir, destName), raw, "utf8");
      created++;
      if (slug) slugToFile.set(slug, destName);
      console.log(`Created ${kind} ${destName}` + (slug ? ` (slug ${slug})` : ""));
    }
  }
  const removed = removeDuplicateSlugFiles(destDir, parseFn, kind, slugToFile);
  return { written: updated + created, updated, created, removed, unchanged };
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

/** Exact event key — never uses device SQLite row ids. */
function activityFingerprint(a) {
  return [
    a.created_at || "",
    a.kind || "",
    a.cocktail_slug || "",
    a.rimmer_slug || "",
    a.pack_slug || a.logged_pack_slug || "",
    a.detail || "",
    a.delta == null ? "" : String(a.delta),
    a.person_name || "",
    a.stars == null ? "" : String(a.stars),
  ].join("|");
}

/**
 * Soft key for History edits: same minute + kind + item + detail + delta.
 * Ignores person_name and sub-minute timestamp so assigning a person / rounding
 * time updates the existing row instead of appending a duplicate.
 */
function activitySoftKey(a) {
  const minute = String(a.created_at || "").slice(0, 16); // YYYY-MM-DDTHH:MM
  return [
    minute,
    a.kind || "",
    a.cocktail_slug || "",
    a.rimmer_slug || "",
    a.pack_slug || a.logged_pack_slug || "",
    a.detail || "",
    a.delta == null ? "" : String(a.delta),
  ].join("|");
}

/** Drop cocktail_id / person_id / id etc. Keep slug/name fields only. */
function portableActivityRow(a) {
  return {
    created_at: a.created_at || "",
    kind: a.kind || "event",
    delta: a.delta != null ? Number(a.delta) : null,
    stars: a.stars != null ? Number(a.stars) : null,
    detail: a.detail || "",
    barcode: a.barcode || "",
    cocktail_name: a.cocktail_name || null,
    cocktail_slug: a.cocktail_slug || null,
    rimmer_name: a.rimmer_name || null,
    rimmer_slug: a.rimmer_slug || null,
    pack_name: a.pack_name || a.logged_pack_name || null,
    pack_slug: a.pack_slug || a.logged_pack_slug || null,
    person_name: a.person_name || null,
  };
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function preferActivityRow(a, b) {
  // Prefer a filled person_name; keep the more precise timestamp when possible.
  const ap = a.person_name ? 1 : 0;
  const bp = b.person_name ? 1 : 0;
  const person = ap >= bp ? a.person_name : b.person_name;
  const aRound = /T\d{2}:\d{2}:00(\.0+)?Z$/.test(a.created_at || "");
  const bRound = /T\d{2}:\d{2}:00(\.0+)?Z$/.test(b.created_at || "");
  let created_at = a.created_at;
  if (aRound && !bRound) created_at = b.created_at;
  else if (!aRound && bRound) created_at = a.created_at;
  else if ((b.created_at || "").length > (a.created_at || "").length) created_at = b.created_at;
  return {
    ...a,
    ...b,
    person_name: person || null,
    created_at: created_at || b.created_at || a.created_at || "",
    cocktail_name: b.cocktail_name || a.cocktail_name || null,
    rimmer_name: b.rimmer_name || a.rimmer_name || null,
    pack_name: b.pack_name || a.pack_name || null,
    pack_slug: b.pack_slug || a.pack_slug || null,
  };
}

function activityEditableMatch(existing, incoming) {
  // Same drink/action in the same minute — but not two different people.
  if (activitySoftKey(existing) !== activitySoftKey(incoming)) return false;
  const ep = existing.person_name || "";
  const ip = incoming.person_name || "";
  if (ep && ip && ep !== ip) return false;
  return true;
}

/**
 * Merge activity: exact fingerprint skip; soft-match person/time edits 1:1
 * (two uses in the same minute stay two rows). Strip SQLite ids.
 */
function mergeActivityJson(incomingPath) {
  const dest = path.join(DATA_DIR, "activity.json");
  const existing = readJsonIfExists(dest).map(portableActivityRow);
  const incoming = readJsonIfExists(incomingPath).map(portableActivityRow);
  if (!incoming.length) {
    if (existing.length) writeJson(dest, existing);
    return { added: 0, updated: 0, total: existing.length };
  }

  const merged = existing.slice();
  const claimed = new Set();
  const exact = new Set(merged.map(activityFingerprint));
  let added = 0;
  let updated = 0;

  for (const p of incoming) {
    const fp = activityFingerprint(p);
    if (exact.has(fp)) continue;

    let matchIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      if (claimed.has(i)) continue;
      if (!activityEditableMatch(merged[i], p)) continue;
      matchIdx = i;
      // Prefer claiming a blank-person row when incoming has a person
      if (!merged[i].person_name && p.person_name) break;
    }

    if (matchIdx >= 0) {
      const prev = merged[matchIdx];
      const next = preferActivityRow(prev, p);
      if (JSON.stringify(prev) !== JSON.stringify(next)) updated++;
      exact.delete(activityFingerprint(prev));
      merged[matchIdx] = next;
      exact.add(activityFingerprint(next));
      claimed.add(matchIdx);
      continue;
    }

    merged.push(p);
    exact.add(fp);
    added++;
  }

  merged.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  writeJson(dest, merged);
  console.log(
    `Merged activity.json: +${added} new, ~${updated} updated (total ${merged.length}, ids stripped)`
  );
  return { added, updated, total: merged.length };
}

/**
 * Preserve existing people rows (including id / field order). Only append names
 * that are not already present, assigning the next numeric id.
 */
function mergePeopleJson(incomingPath) {
  const dest = path.join(DATA_DIR, "people.json");
  const existing = readJsonIfExists(dest);
  const incoming = readJsonIfExists(incomingPath);
  if (!incoming.length) return;

  const byName = new Map();
  let maxId = 0;
  for (const p of existing) {
    if (!p.name) continue;
    byName.set(String(p.name).toLowerCase(), p);
    if (typeof p.id === "number" && p.id > maxId) maxId = p.id;
  }

  const added = [];
  for (const p of incoming) {
    if (!p.name) continue;
    const key = String(p.name).toLowerCase();
    if (byName.has(key)) {
      const prev = byName.get(key);
      if ((p.is_admin === true || p.is_admin === 1) && !prev.is_admin) {
        byName.set(key, { ...prev, is_admin: true });
      }
      continue;
    }
    maxId += 1;
    const row = {
      id: maxId,
      name: p.name,
      created_at: p.created_at || new Date().toISOString(),
      is_admin: !!(p.is_admin === true || p.is_admin === 1),
    };
    byName.set(key, row);
    added.push(row);
  }

  if (!added.length) {
    // Still persist is_admin promotions if any
    const promoted = [...byName.values()];
    const same =
      promoted.length === existing.length &&
      JSON.stringify(promoted) === JSON.stringify(existing);
    if (same) {
      console.log("Merged people.json: no changes");
      return;
    }
  }

  const out = [];
  const used = new Set();
  for (const p of existing) {
    if (!p.name) continue;
    const key = String(p.name).toLowerCase();
    if (used.has(key)) continue;
    out.push(byName.get(key));
    used.add(key);
  }
  for (const p of added) out.push(p);
  writeJson(dest, out);
  console.log(
    `Merged people.json: +${added.length} new (${out.length} total, existing ids preserved)`
  );
}

/**
 * Preserve existing barcode rows (including id). Only append codes that are new.
 */
function mergeBarcodesJson(incomingPath) {
  const dest = path.join(DATA_DIR, "barcodes.json");
  const existing = readJsonIfExists(dest);
  const incoming = readJsonIfExists(incomingPath);
  if (!incoming.length) return;

  const byCode = new Map();
  let maxId = 0;
  for (const b of existing) {
    const code = String(b.code || "").trim();
    if (!code) continue;
    byCode.set(code, b);
    if (typeof b.id === "number" && b.id > maxId) maxId = b.id;
  }

  const added = [];
  for (const b of incoming) {
    const code = String(b.code || "").trim();
    if (!code || byCode.has(code)) continue;
    maxId += 1;
    const row = {
      id: maxId,
      code,
      kind: b.kind || "",
      cocktail_id: null,
      pack_id: null,
      rimmer_id: null,
      case_qty: b.case_qty != null ? Number(b.case_qty) : 1,
      cocktail_name: b.cocktail_name || null,
      cocktail_slug: b.cocktail_slug || null,
      pack_name: b.pack_name || null,
      pack_slug: b.pack_slug || null,
      rimmer_name: b.rimmer_name || null,
      rimmer_slug: b.rimmer_slug || null,
    };
    byCode.set(code, row);
    added.push(row);
  }

  if (!added.length) {
    console.log("Merged barcodes.json: no new codes");
    return;
  }

  const out = [...existing.filter((b) => String(b.code || "").trim()), ...added];
  writeJson(dest, out);
  console.log(
    `Merged barcodes.json: +${added.length} new (${out.length} total, existing ids preserved)`
  );
}

/**
 * Preserve existing ratings; upsert by person_name + cocktail_slug only when new
 * or when stars/comment changed — keep prior row shape when unchanged.
 */
function mergeRatingsJson(incomingPath) {
  const dest = path.join(DATA_DIR, "ratings.json");
  const existing = readJsonIfExists(dest);
  const incoming = readJsonIfExists(incomingPath);
  if (!incoming.length) return;

  const keyOf = (r) =>
    `${String(r.person_name || "").toLowerCase()}|${r.cocktail_slug || ""}`;
  const byKey = new Map();
  let maxId = 0;
  for (const r of existing) {
    if (!r.person_name || !r.cocktail_slug) continue;
    byKey.set(keyOf(r), r);
    if (typeof r.id === "number" && r.id > maxId) maxId = r.id;
  }

  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    if (!r.person_name || !r.cocktail_slug) continue;
    const key = keyOf(r);
    const prev = byKey.get(key);
    if (prev) {
      const stars = r.stars != null ? Number(r.stars) : prev.stars;
      const comment = r.comment || r.detail || prev.comment || "";
      if (stars === prev.stars && comment === (prev.comment || "")) continue;
      byKey.set(key, {
        ...prev,
        stars,
        comment,
        updated_at: r.updated_at || new Date().toISOString(),
      });
      updated++;
      continue;
    }
    maxId += 1;
    byKey.set(key, {
      id: maxId,
      stars: r.stars != null ? Number(r.stars) : null,
      comment: r.comment || r.detail || "",
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || r.created_at || new Date().toISOString(),
      person_name: r.person_name,
      cocktail_slug: r.cocktail_slug,
    });
    added++;
  }

  if (!added && !updated) {
    console.log("Merged ratings.json: no changes");
    return;
  }

  const out = [];
  const used = new Set();
  for (const r of existing) {
    const key = keyOf(r);
    if (!byKey.has(key) || used.has(key)) continue;
    out.push(byKey.get(key));
    used.add(key);
  }
  for (const [key, r] of byKey) {
    if (!used.has(key)) out.push(r);
  }
  writeJson(dest, out);
  console.log(`Merged ratings.json: +${added} new, ~${updated} updated`);
}

function mergeWishlistJson(incomingPath) {
  const dest = path.join(DATA_DIR, "wishlist.json");
  const existing = readJsonIfExists(dest);
  const incoming = readJsonIfExists(incomingPath);
  if (!incoming.length) return;
  const keyOf = (w) => `${w.cocktail_slug || ""}|${w.rimmer_slug || ""}`;
  const byKey = new Map();
  const portable = (w) => ({
    cocktail_slug: w.cocktail_slug || "",
    rimmer_slug: w.rimmer_slug || "",
    qty_wanted: Math.max(1, Number(w.qty_wanted) || 1),
    created_at: w.created_at || "",
    updated_at: w.updated_at || "",
  });
  for (const w of existing) byKey.set(keyOf(w), portable(w));
  for (const w of incoming) byKey.set(keyOf(w), portable(w));
  writeJson(dest, [...byKey.values()]);
  console.log(`Merged wishlist.json: ${byKey.size} items`);
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
    const actPath = path.join(base, "activity.json");
    if (fs.existsSync(actPath)) mergeActivityJson(actPath);
    const peoplePath = path.join(base, "people.json");
    if (fs.existsSync(peoplePath)) mergePeopleJson(peoplePath);
    const barPath = path.join(base, "barcodes.json");
    if (fs.existsSync(barPath)) mergeBarcodesJson(barPath);
    const ratPath = path.join(base, "ratings.json");
    if (fs.existsSync(ratPath)) mergeRatingsJson(ratPath);
    const wishPath = path.join(base, "wishlist.json");
    if (fs.existsSync(wishPath)) mergeWishlistJson(wishPath);
    console.log(
      `Merged into data/: cocktails ${c.updated} inventory-updated/${c.created} new/${c.unchanged} unchanged (${c.removed} dupes removed), ` +
        `packs ${p.updated}/${p.created}/${p.unchanged} (${p.removed} dupes), ` +
        `rimmers ${r.updated}/${r.created}/${r.unchanged} (${r.removed} dupes)`
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
  // Never bake device SQLite ids into the seed (resolve by slug/name at runtime).
  const activity = readJsonIfExists(path.join(DATA_DIR, "activity.json")).map(portableActivityRow);
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
      Merge zip → data/ by slug (inventory fields only on existing .txt;
      JSON merged without SQLite ids), then rebuild seed.
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
