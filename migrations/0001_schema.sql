-- Bartesian D1 schema (mirrors browser sql.js SCHEMA_VERSION 9).
-- Apply once to an empty database. Seed data is imported separately.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spirits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS cocktails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  hero_image TEXT NOT NULL DEFAULT '',
  marketing_image TEXT NOT NULL DEFAULT '',
  image_cut TEXT NOT NULL DEFAULT 'NA',
  glassware TEXT NOT NULL DEFAULT '',
  garnish TEXT NOT NULL DEFAULT '',
  pairs_with TEXT NOT NULL DEFAULT '',
  nutrition_json TEXT NOT NULL DEFAULT '',
  alcohol_json TEXT NOT NULL DEFAULT '',
  bartesian_url TEXT NOT NULL DEFAULT '',
  help_url TEXT NOT NULL DEFAULT '',
  shopify_product_id TEXT NOT NULL DEFAULT '',
  shopify_variant_id TEXT NOT NULL DEFAULT '',
  shopify_handle TEXT NOT NULL DEFAULT '',
  shopify_sku TEXT NOT NULL DEFAULT '',
  gorgias_article_id TEXT NOT NULL DEFAULT '',
  seasonal INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  restock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cocktail_spirits (
  cocktail_id INTEGER NOT NULL,
  spirit_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cocktail_id, spirit_id),
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (spirit_id) REFERENCES spirits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rimmers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  pairs_with TEXT NOT NULL DEFAULT '',
  nutrition_image TEXT NOT NULL DEFAULT '',
  bartesian_url TEXT NOT NULL DEFAULT '',
  help_url TEXT NOT NULL DEFAULT '',
  shopify_product_id TEXT NOT NULL DEFAULT '',
  shopify_variant_id TEXT NOT NULL DEFAULT '',
  shopify_handle TEXT NOT NULL DEFAULT '',
  gorgias_article_id TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  restock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cocktail_rimmers (
  cocktail_id INTEGER NOT NULL,
  rimmer_id INTEGER NOT NULL,
  PRIMARY KEY (cocktail_id, rimmer_id),
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (rimmer_id) REFERENCES rimmers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  nutrition_image TEXT NOT NULL DEFAULT '',
  bartesian_url TEXT NOT NULL DEFAULT '',
  help_url TEXT NOT NULL DEFAULT '',
  shopify_product_id TEXT NOT NULL DEFAULT '',
  shopify_variant_id TEXT NOT NULL DEFAULT '',
  shopify_handle TEXT NOT NULL DEFAULT '',
  gorgias_article_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_items (
  pack_id INTEGER NOT NULL,
  cocktail_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pack_id, cocktail_id),
  FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  cocktail_id INTEGER,
  pack_id INTEGER,
  rimmer_id INTEGER,
  case_qty INTEGER NOT NULL DEFAULT 8,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE,
  FOREIGN KEY (rimmer_id) REFERENCES rimmers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cocktail_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (cocktail_id, person_id),
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cocktail_id INTEGER,
  rimmer_id INTEGER,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (rimmer_id) REFERENCES rimmers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  cocktail_id INTEGER,
  rimmer_id INTEGER,
  pack_id INTEGER,
  person_id INTEGER,
  delta INTEGER,
  stars INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  logged_pack_name TEXT NOT NULL DEFAULT '',
  logged_pack_slug TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (rimmer_id) REFERENCES rimmers(id) ON DELETE CASCADE,
  FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cocktail_id INTEGER,
  rimmer_id INTEGER,
  qty_wanted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE,
  FOREIGN KEY (rimmer_id) REFERENCES rimmers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_globals (
  form_factor TEXT NOT NULL,
  orientation TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (form_factor, orientation)
);

CREATE TABLE IF NOT EXISTS book_cocktail_layouts (
  cocktail_id INTEGER NOT NULL,
  form_factor TEXT NOT NULL,
  orientation TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cocktail_id, form_factor, orientation),
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_cocktail_settings (
  cocktail_id INTEGER PRIMARY KEY,
  image_cut TEXT NOT NULL DEFAULT 'NA',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cocktails_name ON cocktails(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cocktails_slug ON cocktails(slug);
CREATE INDEX IF NOT EXISTS idx_cocktails_quantity ON cocktails(quantity);
CREATE INDEX IF NOT EXISTS idx_rimmers_name ON rimmers(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_packs_name ON packs(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_barcodes_code ON barcodes(code);
CREATE INDEX IF NOT EXISTS idx_barcodes_cocktail ON barcodes(cocktail_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ratings_cocktail ON ratings(cocktail_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_cocktail ON wishlist_items(cocktail_id);
CREATE INDEX IF NOT EXISTS idx_cocktail_spirits_spirit ON cocktail_spirits(spirit_id);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '9');
