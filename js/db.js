(function (global) {
  const IDB_NAME = "bartesian-sqlite";
  const IDB_STORE = "kv";
  const DB_KEY = "database";
  const SCHEMA_VERSION = 8;
  /** Bump when seed barcodes should be re-merged into an existing local DB. */
  const SEED_BARCODE_REV = 1;

  const SEED_SQL = `
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

    INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
  `;

  let SQL = null;
  let db = null;

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbSet(key, value) {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(key) {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function exec(sql, params) {
    db.run(sql, params || []);
  }

  function query(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryOne(sql, params) {
    return query(sql, params)[0] || null;
  }

  async function persist() {
    const data = db.export();
    await idbSet(DB_KEY, data);
  }

  function logActivity(a) {
    if (!db) return;
    try {
      exec(
        `INSERT INTO activity_log
           (created_at, kind, cocktail_id, rimmer_id, pack_id, person_id, delta, stars, detail, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.created_at || nowIso(),
          a.kind || "event",
          a.cocktailId || null,
          a.rimmerId || null,
          a.packId || null,
          a.personId || null,
          a.delta != null ? Number(a.delta) : null,
          a.stars != null ? Number(a.stars) : null,
          a.detail || "",
          a.barcode || "",
        ]
      );
    } catch (_) {
      /* activity table missing on very old DB before migration */
    }
  }

  function tableColumns(table) {
    try {
      return query("PRAGMA table_info(" + table + ")").map((r) => r.name);
    } catch (_) {
      return [];
    }
  }

  /** Non-destructive migration for existing IndexedDBs (no schema wipe). */
  function ensureExtensions() {
    let changed = 0;
    const createSql = [
      `CREATE TABLE IF NOT EXISTS activity_log (
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
        barcode TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS wishlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cocktail_id INTEGER,
        rimmer_id INTEGER,
        qty_wanted INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ];
    for (const sql of createSql) {
      try { exec(sql); changed++; } catch (_) {}
    }
    // One-time scratch reset (2026-10-19): zero quantities, clear favorites,
    // restock flags, wishlist, and all history. Guarded by a meta flag so it
    // runs exactly once per existing DB; the zeroed seed keeps fresh DBs clean.
    try {
      const purged = queryOne("SELECT value FROM meta WHERE key = 'scratch_reset_v1'");
      if (!purged || purged.value !== "1") {
        const wipe = [
          "DELETE FROM activity_log",
          "DELETE FROM inventory_log",
          "DELETE FROM wishlist_items",
          "UPDATE cocktails SET quantity = 0, restock = 0, favorite = 0",
          "UPDATE rimmers SET quantity = 0, restock = 0, favorite = 0",
        ];
        for (const sql of wipe) {
          try { exec(sql); } catch (_) {}
        }
        exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('scratch_reset_v1', '1')");
        changed++;
      }
    } catch (_) {}
    // People: is_admin column + rename seed "Me" → "Lawrence" (once)
    try {
      const pcols = tableColumns("people");
      if (pcols.length && !pcols.includes("is_admin")) {
        exec("ALTER TABLE people ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
        changed++;
      }
      const seeded = queryOne("SELECT value FROM meta WHERE key = 'lawrence_seeded'");
      if (!seeded || seeded.value !== "1") {
        const lawrence = queryOne("SELECT id FROM people WHERE name = 'Lawrence' COLLATE NOCASE");
        if (!lawrence) {
          exec("UPDATE people SET name = 'Lawrence' WHERE name = 'Me' COLLATE NOCASE");
        }
        exec("UPDATE people SET is_admin = 1 WHERE name = 'Lawrence' COLLATE NOCASE");
        exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('lawrence_seeded', '1')");
        changed++;
      }
    } catch (_) {}
    // Rimmer spelling: "Cinamon" → "Cinnamon" (rename in place so id/links survive)
    try {
      const oldRimmer = queryOne(
        "SELECT id FROM rimmers WHERE slug = 'sweet-cinamon-vanilla-sugar-rimmer'"
      );
      const newRimmer = queryOne(
        "SELECT id FROM rimmers WHERE slug = 'sweet-cinnamon-vanilla-sugar-rimmer'"
      );
      if (oldRimmer && !newRimmer) {
        exec(
          "UPDATE rimmers SET slug = 'sweet-cinnamon-vanilla-sugar-rimmer', name = 'Sweet Cinnamon Vanilla Sugar Rimmer', image = 'images/rimmers/sweet-cinnamon-vanilla-sugar-rimmer.jpg' WHERE id = ?",
          [oldRimmer.id]
        );
        changed++;
      } else if (newRimmer) {
        exec(
          "UPDATE rimmers SET name = 'Sweet Cinnamon Vanilla Sugar Rimmer', image = CASE WHEN image IS NULL OR image = '' THEN 'images/rimmers/sweet-cinnamon-vanilla-sugar-rimmer.jpg' ELSE image END WHERE id = ? AND (name = 'Sweet Cinamon Vanilla Sugar Rimmer' OR image IS NULL OR image = '')",
          [newRimmer.id]
        );
      }
    } catch (_) {}
    for (const table of ["cocktails", "rimmers"]) {
      const cols = tableColumns(table);
      if (cols.length && !cols.includes("restock")) {
        try {
          exec("ALTER TABLE " + table + " ADD COLUMN restock INTEGER NOT NULL DEFAULT 0");
          changed++;
        } catch (_) {}
      }
      // Normalize missing/odd restock values to 0/1 (null → 0)
      try {
        exec(
          "UPDATE " + table + " SET restock = CASE WHEN restock = 1 THEN 1 ELSE 0 END WHERE restock IS NULL OR restock NOT IN (0, 1)"
        );
        changed++;
      } catch (_) {}
    }
    return changed;
  }

  function restockForTransition(prev, next, current) {
    if (prev === 1 && next === 0) return 1;
    if (prev === 0 && next > 0) return 0;
    return Number(current) === 1 ? 1 : 0;
  }

  function ensureSpirit(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const existing = queryOne("SELECT id FROM spirits WHERE name = ? COLLATE NOCASE", [trimmed]);
    if (existing) return existing.id;
    exec("INSERT INTO spirits (name) VALUES (?)", [trimmed]);
    return queryOne("SELECT last_insert_rowid() AS id").id;
  }

  function setCocktailSpirits(cocktailId, spiritNames) {
    exec("DELETE FROM cocktail_spirits WHERE cocktail_id = ?", [cocktailId]);
    (spiritNames || []).forEach((name, i) => {
      const sid = ensureSpirit(name);
      if (sid) {
        exec(
          "INSERT OR IGNORE INTO cocktail_spirits (cocktail_id, spirit_id, sort_order) VALUES (?, ?, ?)",
          [cocktailId, sid, i]
        );
      }
    });
  }

  function slugifyText(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** Point a barcode kind at an item (or clear it when code is blank). */
  function syncItemBarcode(kind, code, refs) {
    const col = refs.cocktailId ? "cocktail_id" : refs.packId ? "pack_id" : "rimmer_id";
    const itemId = refs.cocktailId || refs.packId || refs.rimmerId;
    const trimmed = String(code || "").trim();
    const existing = query("SELECT code FROM barcodes WHERE kind = ? AND " + col + " = ?", [kind, itemId]);
    for (const row of existing) {
      if (row.code !== trimmed) exec("DELETE FROM barcodes WHERE code = ?", [row.code]);
    }
    if (!trimmed) return;
    const byCode = queryOne("SELECT id FROM barcodes WHERE code = ?", [trimmed]);
    const caseQty = kind === "case" ? Number(refs.caseQty) || 8 : kind === "variety_pack" ? 0 : 1;
    if (byCode) {
      exec(
        "UPDATE barcodes SET kind = ?, cocktail_id = ?, pack_id = ?, rimmer_id = ?, case_qty = ? WHERE code = ?",
        [kind, refs.cocktailId || null, refs.packId || null, refs.rimmerId || null, caseQty, trimmed]
      );
    } else {
      exec(
        "INSERT INTO barcodes (code, kind, cocktail_id, pack_id, rimmer_id, case_qty) VALUES (?, ?, ?, ?, ?, ?)",
        [trimmed, kind, refs.cocktailId || null, refs.packId || null, refs.rimmerId || null, caseQty]
      );
    }
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

  function insertCocktail(c) {
    const ts = nowIso();
    const hero = c.hero_image || "";
    const marketing = c.marketing_image || "";
    const primary = c.image || hero || marketing || "";
    exec(
      `INSERT INTO cocktails (
        slug, name, description, details, image, hero_image, marketing_image,
        glassware, garnish, pairs_with, nutrition_json, alcohol_json,
        bartesian_url, help_url, shopify_product_id, shopify_variant_id,
        shopify_handle, shopify_sku, gorgias_article_id, seasonal, favorite,
        enabled, quantity, restock, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.slug,
        c.name,
        c.description || "",
        c.details || "",
        primary,
        hero,
        marketing,
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
        ts,
        ts,
      ]
    );
    const id = queryOne("SELECT last_insert_rowid() AS id").id;
    setCocktailSpirits(id, c.spirits || []);

    if (c.capsule_barcode) {
      exec(
        "INSERT OR IGNORE INTO barcodes (code, kind, cocktail_id, case_qty) VALUES (?, 'capsule', ?, 1)",
        [String(c.capsule_barcode), id]
      );
    }
    if (c.case_barcode) {
      exec(
        "INSERT OR IGNORE INTO barcodes (code, kind, cocktail_id, case_qty) VALUES (?, 'case', ?, ?)",
        [String(c.case_barcode), id, Number(c.case_qty) || 8]
      );
    }
    return id;
  }

  function insertRimmer(r, cocktailSlugToId) {
    const ts = nowIso();
    exec(
      `INSERT INTO rimmers (
        slug, name, description, image, kind, pairs_with, nutrition_image,
        bartesian_url, help_url, shopify_product_id, shopify_variant_id,
        shopify_handle, gorgias_article_id, favorite, enabled, quantity, restock,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        ts,
        ts,
      ]
    );
    const id = queryOne("SELECT last_insert_rowid() AS id").id;
    const slugs = r.cocktail_slugs || r.pair_slugs || [];
    (Array.isArray(slugs) ? slugs : String(slugs).split(",").map((s) => s.trim()).filter(Boolean)).forEach(
      (slug) => {
        const cid = cocktailSlugToId[slug];
        if (!cid) return;
        exec("INSERT OR IGNORE INTO cocktail_rimmers (cocktail_id, rimmer_id) VALUES (?, ?)", [
          cid,
          id,
        ]);
      }
    );
    if (r.barcode) {
      exec(
        "INSERT OR IGNORE INTO barcodes (code, kind, rimmer_id, case_qty) VALUES (?, 'rimmer', ?, 1)",
        [String(r.barcode), id]
      );
    }
    return id;
  }

  function insertPack(p, slugToId) {
    const ts = nowIso();
    exec(
      `INSERT INTO packs (
        slug, name, notes, image, nutrition_image, bartesian_url, help_url,
        shopify_product_id, shopify_variant_id, shopify_handle, gorgias_article_id,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        ts,
        ts,
      ]
    );
    const packId = queryOne("SELECT last_insert_rowid() AS id").id;
    (p.items || []).forEach((item) => {
      const cid = slugToId[item.cocktail_slug];
      if (!cid) return;
      exec(
        "INSERT OR IGNORE INTO pack_items (pack_id, cocktail_id, qty) VALUES (?, ?, ?)",
        [packId, cid, Number(item.qty) || 1]
      );
    });
    if (p.barcode) {
      exec(
        "INSERT OR IGNORE INTO barcodes (code, kind, pack_id, case_qty) VALUES (?, 'variety_pack', ?, 0)",
        [String(p.barcode), packId]
      );
    }
    return packId;
  }

  function seedAll() {
    const seed = global.BARTESIAN_SEED || { people: [], cocktails: [], packs: [], rimmers: [] };
    for (const person of seed.people || []) {
      if (!person.name) continue;
      exec("INSERT OR IGNORE INTO people (name, is_admin, created_at) VALUES (?, ?, ?)", [
        person.name,
        person.is_admin ? 1 : 0,
        nowIso(),
      ]);
    }
    const slugToId = {};
    for (const c of seed.cocktails || []) {
      if (!c.slug || !c.name) continue;
      slugToId[c.slug] = insertCocktail(c);
    }
    const rimmerSlugToId = {};
    for (const r of seed.rimmers || []) {
      if (!r.slug || !r.name) continue;
      rimmerSlugToId[r.slug] = insertRimmer(r, slugToId);
    }
    const packSlugToId = {};
    for (const p of seed.packs || []) {
      if (!p.slug || !p.name) continue;
      packSlugToId[p.slug] = insertPack(p, slugToId);
    }
    seedWishlistAndActivity(slugToId, rimmerSlugToId, packSlugToId);
  }

  function seedWishlistAndActivity(cocktailSlugToId, rimmerSlugToId, packSlugToId) {
    const seed = global.BARTESIAN_SEED || {};
    const ts = nowIso();
    for (const w of seed.wishlist || []) {
      const cid = w.cocktail_slug ? cocktailSlugToId[w.cocktail_slug] : null;
      const rid = w.rimmer_slug ? rimmerSlugToId[w.rimmer_slug] : null;
      if (!cid && !rid) continue;
      exec(
        "INSERT INTO wishlist_items (cocktail_id, rimmer_id, qty_wanted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [cid || null, rid || null, Math.max(1, Number(w.qty_wanted) || 1), w.created_at || ts, w.updated_at || w.created_at || ts]
      );
    }
    // People for activity person_name resolution
    const personByName = {};
    for (const p of query("SELECT id, name FROM people")) personByName[p.name] = p.id;
    for (const a of seed.activity || []) {
      exec(
        `INSERT INTO activity_log
           (created_at, kind, cocktail_id, rimmer_id, pack_id, person_id, delta, stars, detail, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.created_at || ts,
          a.kind || "event",
          a.cocktail_slug ? cocktailSlugToId[a.cocktail_slug] || null : null,
          a.rimmer_slug ? rimmerSlugToId[a.rimmer_slug] || null : null,
          a.pack_slug ? packSlugToId[a.pack_slug] || null : null,
          a.person_name ? personByName[a.person_name] || null : a.person_id || null,
          a.delta != null ? Number(a.delta) : null,
          a.stars != null ? Number(a.stars) : null,
          a.detail || "",
          a.barcode || "",
        ]
      );
    }
  }

  /** Merge seed wishlist/activity (from import) into an existing DB; dedupe activity. */
  function mergeSeedWishlistAndActivity() {
    const seed = global.BARTESIAN_SEED || {};
    let changed = 0;
    const cocktailBySlug = {};
    for (const r of query("SELECT id, slug FROM cocktails")) cocktailBySlug[r.slug] = r.id;
    const rimmerBySlug = {};
    for (const r of query("SELECT id, slug FROM rimmers")) rimmerBySlug[r.slug] = r.id;
    const packBySlug = {};
    for (const r of query("SELECT id, slug FROM packs")) packBySlug[r.slug] = r.id;
    const personByName = {};
    for (const p of query("SELECT id, name FROM people")) personByName[p.name] = p.id;

    for (const w of seed.wishlist || []) {
      const cid = w.cocktail_slug ? cocktailBySlug[w.cocktail_slug] : null;
      const rid = w.rimmer_slug ? rimmerBySlug[w.rimmer_slug] : null;
      if (!cid && !rid) continue;
      const existing = cid
        ? queryOne("SELECT id FROM wishlist_items WHERE cocktail_id = ?", [cid])
        : queryOne("SELECT id FROM wishlist_items WHERE rimmer_id = ?", [rid]);
      const qty = Math.max(1, Number(w.qty_wanted) || 1);
      if (existing) {
        exec("UPDATE wishlist_items SET qty_wanted = ?, updated_at = ? WHERE id = ?", [qty, nowIso(), existing.id]);
      } else {
        exec(
          "INSERT INTO wishlist_items (cocktail_id, rimmer_id, qty_wanted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          [cid || null, rid || null, qty, w.created_at || nowIso(), nowIso()]
        );
      }
      changed++;
    }

    for (const a of seed.activity || []) {
      const cid = a.cocktail_slug ? cocktailBySlug[a.cocktail_slug] || null : null;
      const rid = a.rimmer_slug ? rimmerBySlug[a.rimmer_slug] || null : null;
      const pid = a.pack_slug ? packBySlug[a.pack_slug] || null : null;
      const personId = a.person_name ? personByName[a.person_name] || null : null;
      const created = a.created_at || "";
      if (!created) continue;
      const dup = queryOne(
        `SELECT id FROM activity_log WHERE created_at = ? AND kind = ?
           AND IFNULL(cocktail_id,0)=IFNULL(?,0) AND IFNULL(rimmer_id,0)=IFNULL(?,0)
           AND IFNULL(detail,'')=IFNULL(?, '') AND IFNULL(delta,0)=IFNULL(?,0)`,
        [created, a.kind || "event", cid, rid, a.detail || "", a.delta != null ? Number(a.delta) : null]
      );
      if (dup) continue;
      logActivity({
        created_at: created,
        kind: a.kind || "event",
        cocktailId: cid, rimmerId: rid, packId: pid, personId,
        delta: a.delta, stars: a.stars, detail: a.detail || "", barcode: a.barcode || "",
      });
      changed++;
    }
    return changed;
  }

  function createFreshDb() {
    db = new SQL.Database();
    db.run("PRAGMA foreign_keys = ON");
    db.run(SEED_SQL);
    seedAll();
    exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_barcode_rev', ?)",
      [String(SEED_BARCODE_REV)]
    );
    exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('lawrence_seeded', '1')");
    exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('scratch_reset_v1', '1')");
    if (global.BARTESIAN_SEED_REV) {
      exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seed_rev', ?)",
        [String(global.BARTESIAN_SEED_REV)]
      );
    }
  }

  /** Copy cocktail/rimmer quantities + restock flags from seed into the live DB. */
  function applySeedInventory() {
    const seed = global.BARTESIAN_SEED || {};
    let changed = 0;
    const ts = nowIso();
    for (const c of seed.cocktails || []) {
      if (!c.slug) continue;
      const row = queryOne("SELECT id, quantity, restock FROM cocktails WHERE slug = ?", [c.slug]);
      if (!row) continue;
      const q = Number(c.quantity) || 0;
      const restock = c.restock ? 1 : 0;
      if (Number(row.quantity) !== q || Number(row.restock || 0) !== restock) {
        exec("UPDATE cocktails SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?", [
          q, restock, ts, row.id,
        ]);
        changed++;
      }
    }
    for (const r of seed.rimmers || []) {
      if (!r.slug) continue;
      const row = queryOne("SELECT id, quantity, restock FROM rimmers WHERE slug = ?", [r.slug]);
      if (!row) continue;
      const q = Number(r.quantity) || 0;
      const restock = r.restock ? 1 : 0;
      if (Number(row.quantity) !== q || Number(row.restock || 0) !== restock) {
        exec("UPDATE rimmers SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?", [
          q, restock, ts, row.id,
        ]);
        changed++;
      }
    }
    // Packs: sync enabled + image so seed edits (e.g. disabling EU/UK packs,
    // adding US pack thumbnails) reach existing DBs without a reset.
    for (const p of seed.packs || []) {
      if (!p.slug) continue;
      const row = queryOne("SELECT id, enabled, image FROM packs WHERE slug = ?", [p.slug]);
      if (!row) continue;
      const enabled = p.enabled === 0 || p.enabled === false ? 0 : 1;
      const image = p.image || "";
      if (Number(row.enabled) !== enabled || String(row.image || "") !== image) {
        exec("UPDATE packs SET enabled = ?, image = ?, updated_at = ? WHERE id = ?", [
          enabled, image, ts, row.id,
        ]);
        changed++;
      }
    }
    return changed;
  }

  /**
   * When import-data.js bumps BARTESIAN_SEED_REV, pull inventory (and barcodes)
   * from the new seed into IndexedDB without a full wipe.
   */
  function maybeApplySeedRev() {
    const seedRev = global.BARTESIAN_SEED_REV != null ? String(global.BARTESIAN_SEED_REV) : "";
    const applied = queryOne("SELECT value FROM meta WHERE key = 'applied_seed_rev'");
    let changed = 0;
    if (seedRev && (!applied || applied.value !== seedRev)) {
      changed += applySeedInventory();
      try { changed += mergeSeedWishlistAndActivity(); } catch (_) {}
      exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seed_rev', ?)",
        [seedRev]
      );
      changed += 1;
    }
    changed += maybeMergeSeedBarcodes();
    return changed;
  }

  /**
   * Upsert capsule/case/pack barcodes from seed without wiping inventory.
   * Needed when .txt / seed-data.js gain Case Barcode values after first install.
   */
  function mergeSeedBarcodes() {
    const seed = global.BARTESIAN_SEED || {};
    let changed = 0;

    for (const c of seed.cocktails || []) {
      if (!c.slug) continue;
      const row = queryOne("SELECT id FROM cocktails WHERE slug = ?", [c.slug]);
      if (!row) continue;
      const cocktailId = row.id;
      if (c.capsule_barcode) {
        const code = String(c.capsule_barcode).trim();
        if (code) {
          const existing = queryOne("SELECT id FROM barcodes WHERE code = ?", [code]);
          if (!existing) {
            exec(
              "INSERT INTO barcodes (code, kind, cocktail_id, case_qty) VALUES (?, 'capsule', ?, 1)",
              [code, cocktailId]
            );
            changed++;
          }
        }
      }
      if (c.case_barcode) {
        const code = String(c.case_barcode).trim();
        if (code) {
          const existing = queryOne("SELECT id, kind, cocktail_id FROM barcodes WHERE code = ?", [
            code,
          ]);
          if (!existing) {
            exec(
              "INSERT INTO barcodes (code, kind, cocktail_id, case_qty) VALUES (?, 'case', ?, ?)",
              [code, cocktailId, Number(c.case_qty) || 8]
            );
            changed++;
          } else if (existing.kind !== "case" || existing.cocktail_id !== cocktailId) {
            exec(
              `UPDATE barcodes SET kind = 'case', cocktail_id = ?, pack_id = NULL, rimmer_id = NULL,
               case_qty = ? WHERE code = ?`,
              [cocktailId, Number(c.case_qty) || 8, code]
            );
            changed++;
          }
        }
      }
    }

    for (const p of seed.packs || []) {
      if (!p.slug || !p.barcode) continue;
      const code = String(p.barcode).trim();
      if (!code) continue;
      const pack = queryOne("SELECT id FROM packs WHERE slug = ?", [p.slug]);
      if (!pack) continue;
      const existing = queryOne("SELECT id FROM barcodes WHERE code = ?", [code]);
      if (!existing) {
        exec(
          "INSERT INTO barcodes (code, kind, pack_id, case_qty) VALUES (?, 'variety_pack', ?, 0)",
          [code, pack.id]
        );
        changed++;
      }
    }

    for (const r of seed.rimmers || []) {
      if (!r.slug || !r.barcode) continue;
      const code = String(r.barcode).trim();
      if (!code) continue;
      const rim = queryOne("SELECT id FROM rimmers WHERE slug = ?", [r.slug]);
      if (!rim) continue;
      const existing = queryOne("SELECT id FROM barcodes WHERE code = ?", [code]);
      if (!existing) {
        exec(
          "INSERT INTO barcodes (code, kind, rimmer_id, case_qty) VALUES (?, 'rimmer', ?, 1)",
          [code, rim.id]
        );
        changed++;
      }
    }

    return changed;
  }

  function maybeMergeSeedBarcodes() {
    const ver = queryOne("SELECT value FROM meta WHERE key = 'seed_barcode_rev'");
    const revStale = !ver || Number(ver.value) !== SEED_BARCODE_REV;
    const changed = mergeSeedBarcodes();
    if (changed || revStale) {
      exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_barcode_rev', ?)",
        [String(SEED_BARCODE_REV)]
      );
    }
    return changed + (revStale ? 1 : 0);
  }

  function rowToCocktail(row) {
    if (!row) return null;
    return {
      ...row,
      favorite: !!row.favorite,
      seasonal: !!row.seasonal,
      enabled: row.enabled === undefined || row.enabled === null ? true : !!row.enabled,
      quantity: Number(row.quantity) || 0,
      restock: Number(row.restock || 0) === 1,
      avg_rating: row.avg_rating != null ? Number(row.avg_rating) : null,
      rating_count: Number(row.rating_count) || 0,
      primary_spirit: row.primary_spirit || "",
      spirits: row.spirits_csv
        ? String(row.spirits_csv)
            .split("|")
            .filter(Boolean)
        : undefined,
    };
  }

  function rowToRimmer(row) {
    if (!row) return null;
    return {
      ...row,
      favorite: !!row.favorite,
      enabled: row.enabled === undefined || row.enabled === null ? true : !!row.enabled,
      quantity: Number(row.quantity) || 0,
      restock: Number(row.restock || 0) === 1,
    };
  }

  const listSelect = `
    SELECT c.*,
      (SELECT GROUP_CONCAT(s.name, '|') FROM cocktail_spirits cs
         JOIN spirits s ON s.id = cs.spirit_id
         WHERE cs.cocktail_id = c.id) AS spirits_csv,
      (SELECT s.name FROM cocktail_spirits cs
         JOIN spirits s ON s.id = cs.spirit_id
         WHERE cs.cocktail_id = c.id ORDER BY cs.sort_order LIMIT 1) AS primary_spirit,
      (SELECT AVG(r.stars * 1.0) FROM ratings r WHERE r.cocktail_id = c.id) AS avg_rating,
      (SELECT COUNT(*) FROM ratings r WHERE r.cocktail_id = c.id) AS rating_count
    FROM cocktails c
  `;

  const api = {
    async init() {
      SQL = await initSqlJs({
        locateFile: (file) =>
          `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${file}`,
      });
      const saved = await idbGet(DB_KEY);
      if (saved) {
        db = new SQL.Database(new Uint8Array(saved));
        db.run("PRAGMA foreign_keys = ON");
        const ver = queryOne("SELECT value FROM meta WHERE key = 'schema_version'");
        if (!ver || Number(ver.value) !== SCHEMA_VERSION) {
          db.close();
          createFreshDb();
          await persist();
        } else {
          ensureExtensions();
          if (maybeApplySeedRev() > 0) await persist();
          else await persist();
        }
      } else {
        createFreshDb();
        await persist();
      }
    },

    async resetLocal() {
      await idbDelete(DB_KEY);
      createFreshDb();
      await persist();
    },

    listSpirits() {
      return query("SELECT * FROM spirits ORDER BY name COLLATE NOCASE");
    },

    listPeople() {
      return query("SELECT * FROM people ORDER BY name COLLATE NOCASE").map((p) => ({
        ...p,
        is_admin: Number(p.is_admin || 0) === 1,
      }));
    },

    async addPerson(name) {
      const trimmed = String(name || "").trim();
      if (!trimmed) throw new Error("Name required");
      exec("INSERT OR IGNORE INTO people (name, created_at) VALUES (?, ?)", [
        trimmed,
        nowIso(),
      ]);
      await persist();
      return queryOne("SELECT * FROM people WHERE name = ? COLLATE NOCASE", [trimmed]);
    },

    async setPersonAdmin(personId, isAdmin) {
      exec("UPDATE people SET is_admin = ? WHERE id = ?", [isAdmin ? 1 : 0, personId]);
      await persist();
      const p = queryOne("SELECT * FROM people WHERE id = ?", [personId]);
      return p ? { ...p, is_admin: Number(p.is_admin || 0) === 1 } : null;
    },

    findPersonByName(name) {
      const p = queryOne("SELECT * FROM people WHERE name = ? COLLATE NOCASE", [String(name || "")]);
      return p ? { ...p, is_admin: Number(p.is_admin || 0) === 1 } : null;
    },

    async setCocktailEnabled(id, enabled) {
      exec("UPDATE cocktails SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, nowIso(), id]);
      await persist();
    },

    async setCocktailSeasonal(id, seasonal) {
      exec("UPDATE cocktails SET seasonal = ?, updated_at = ? WHERE id = ?", [seasonal ? 1 : 0, nowIso(), id]);
      await persist();
    },

    async setRimmerEnabled(id, enabled) {
      exec("UPDATE rimmers SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, nowIso(), id]);
      await persist();
    },

    /** Admin edit: name + free-text type (kind column; slug/id stay put). */
    async updateRimmerDetails(id, { name, kind } = {}) {
      const trimmedName = String(name || "").trim();
      if (!trimmedName) throw new Error("Rimmer name is required.");
      const trimmedKind = String(kind || "").trim();
      exec("UPDATE rimmers SET name = ?, kind = ?, updated_at = ? WHERE id = ?", [
        trimmedName,
        trimmedKind,
        nowIso(),
        id,
      ]);
      await persist();
      return rowToRimmer(queryOne("SELECT * FROM rimmers WHERE id = ?", [id]));
    },

    /** Form data for the full admin Add/Edit screens (all DB fields + links). */
    getCocktailForEdit(id) {
      const c = this.getCocktail(id);
      if (!c) return null;
      const cap = queryOne("SELECT code FROM barcodes WHERE cocktail_id = ? AND kind = 'capsule'", [id]);
      const caseRow = queryOne("SELECT code, case_qty FROM barcodes WHERE cocktail_id = ? AND kind = 'case'", [id]);
      return {
        ...c,
        capsule_barcode: cap ? cap.code : "",
        case_barcode: caseRow ? caseRow.code : "",
        case_qty: caseRow ? caseRow.case_qty : 8,
        rimmer_ids: this.rimmersForCocktail(id).map((r) => r.id),
      };
    },

    getRimmerForEdit(id) {
      const r = this.getRimmer(id);
      if (!r) return null;
      const bc = queryOne("SELECT code FROM barcodes WHERE rimmer_id = ? AND kind = 'rimmer'", [id]);
      return {
        ...r,
        barcode: bc ? bc.code : "",
        cocktail_ids: this.cocktailsForRimmer(id).map((c) => c.id),
      };
    },

    getPackForEdit(id) {
      const p = this.getPack(id);
      if (!p) return null;
      const bc = queryOne("SELECT code FROM barcodes WHERE pack_id = ? AND kind = 'variety_pack'", [id]);
      return {
        ...p,
        barcode: bc ? bc.code : "",
        items: this.getPackItems(id).map((i) => ({ cocktail_id: i.id, qty: i.qty })),
      };
    },

    /** Create (id null) or fully update a cocktail — every DB field. */
    async saveCocktail(id, d) {
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Cocktail name is required.");
      const slug = slugifyText(d.slug) || slugifyText(name);
      if (!slug) throw new Error("Cocktail slug is required.");
      const clash = queryOne("SELECT id FROM cocktails WHERE slug = ?", [slug]);
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const hero = String(d.hero_image || "");
      const marketing = String(d.marketing_image || "");
      const values = [
        slug, name, String(d.description || ""), String(d.details || ""),
        String(d.image || "") || hero || marketing, hero, marketing,
        String(d.glassware || ""), String(d.garnish || ""), String(d.pairs_with || ""),
        jsonField(d.nutrition_json), jsonField(d.alcohol_json),
        String(d.bartesian_url || ""), String(d.help_url || ""),
        String(d.shopify_product_id || ""), String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""), String(d.shopify_sku || ""), String(d.gorgias_article_id || ""),
        d.seasonal ? 1 : 0, d.favorite ? 1 : 0, d.enabled ? 1 : 0,
        Math.max(0, Number(d.quantity) || 0), d.restock ? 1 : 0,
      ];
      let cid = id ? Number(id) : null;
      if (cid) {
        if (!queryOne("SELECT id FROM cocktails WHERE id = ?", [cid])) throw new Error("Cocktail not found.");
        exec(
          `UPDATE cocktails SET slug=?, name=?, description=?, details=?, image=?, hero_image=?, marketing_image=?,
             glassware=?, garnish=?, pairs_with=?, nutrition_json=?, alcohol_json=?, bartesian_url=?, help_url=?,
             shopify_product_id=?, shopify_variant_id=?, shopify_handle=?, shopify_sku=?, gorgias_article_id=?,
             seasonal=?, favorite=?, enabled=?, quantity=?, restock=?, updated_at=? WHERE id=?`,
          [...values, ts, cid]
        );
      } else {
        exec(
          `INSERT INTO cocktails (slug, name, description, details, image, hero_image, marketing_image,
             glassware, garnish, pairs_with, nutrition_json, alcohol_json, bartesian_url, help_url,
             shopify_product_id, shopify_variant_id, shopify_handle, shopify_sku, gorgias_article_id,
             seasonal, favorite, enabled, quantity, restock, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [...values, ts, ts]
        );
        cid = queryOne("SELECT last_insert_rowid() AS id").id;
      }
      setCocktailSpirits(cid, Array.isArray(d.spirits) ? d.spirits : String(d.spirits || "").split(","));
      exec("DELETE FROM cocktail_rimmers WHERE cocktail_id = ?", [cid]);
      for (const rid of d.rimmer_ids || []) {
        exec("INSERT OR IGNORE INTO cocktail_rimmers (cocktail_id, rimmer_id) VALUES (?, ?)", [cid, Number(rid)]);
      }
      syncItemBarcode("capsule", d.capsule_barcode, { cocktailId: cid });
      syncItemBarcode("case", d.case_barcode, { cocktailId: cid, caseQty: d.case_qty });
      await persist();
      return this.getCocktail(cid);
    },

    /** Create (id null) or fully update a rimmer — every DB field. */
    async saveRimmer(id, d) {
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Rimmer name is required.");
      const slug = slugifyText(d.slug) || slugifyText(name);
      if (!slug) throw new Error("Rimmer slug is required.");
      const clash = queryOne("SELECT id FROM rimmers WHERE slug = ?", [slug]);
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const values = [
        slug, name, String(d.description || ""), String(d.image || ""), String(d.kind || ""),
        String(d.pairs_with || ""), String(d.nutrition_image || ""),
        String(d.bartesian_url || ""), String(d.help_url || ""),
        String(d.shopify_product_id || ""), String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""), String(d.gorgias_article_id || ""),
        d.favorite ? 1 : 0, d.enabled ? 1 : 0,
        Math.max(0, Number(d.quantity) || 0), d.restock ? 1 : 0,
      ];
      let rid = id ? Number(id) : null;
      if (rid) {
        if (!queryOne("SELECT id FROM rimmers WHERE id = ?", [rid])) throw new Error("Rimmer not found.");
        exec(
          `UPDATE rimmers SET slug=?, name=?, description=?, image=?, kind=?, pairs_with=?, nutrition_image=?,
             bartesian_url=?, help_url=?, shopify_product_id=?, shopify_variant_id=?, shopify_handle=?,
             gorgias_article_id=?, favorite=?, enabled=?, quantity=?, restock=?, updated_at=? WHERE id=?`,
          [...values, ts, rid]
        );
      } else {
        exec(
          `INSERT INTO rimmers (slug, name, description, image, kind, pairs_with, nutrition_image,
             bartesian_url, help_url, shopify_product_id, shopify_variant_id, shopify_handle,
             gorgias_article_id, favorite, enabled, quantity, restock, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [...values, ts, ts]
        );
        rid = queryOne("SELECT last_insert_rowid() AS id").id;
      }
      exec("DELETE FROM cocktail_rimmers WHERE rimmer_id = ?", [rid]);
      for (const cid of d.cocktail_ids || []) {
        exec("INSERT OR IGNORE INTO cocktail_rimmers (cocktail_id, rimmer_id) VALUES (?, ?)", [Number(cid), rid]);
      }
      syncItemBarcode("rimmer", d.barcode, { rimmerId: rid });
      await persist();
      return this.getRimmer(rid);
    },

    /** Create (id null) or fully update a variety pack — every DB field. */
    async savePack(id, d) {
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Pack name is required.");
      const slug = slugifyText(d.slug) || slugifyText(name);
      if (!slug) throw new Error("Pack slug is required.");
      const clash = queryOne("SELECT id FROM packs WHERE slug = ?", [slug]);
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const values = [
        slug, name, String(d.notes || ""), String(d.image || ""), String(d.nutrition_image || ""),
        String(d.bartesian_url || ""), String(d.help_url || ""),
        String(d.shopify_product_id || ""), String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""), String(d.gorgias_article_id || ""),
        d.enabled ? 1 : 0,
      ];
      let pid = id ? Number(id) : null;
      if (pid) {
        if (!queryOne("SELECT id FROM packs WHERE id = ?", [pid])) throw new Error("Pack not found.");
        exec(
          `UPDATE packs SET slug=?, name=?, notes=?, image=?, nutrition_image=?, bartesian_url=?, help_url=?,
             shopify_product_id=?, shopify_variant_id=?, shopify_handle=?, gorgias_article_id=?,
             enabled=?, updated_at=? WHERE id=?`,
          [...values, ts, pid]
        );
      } else {
        exec(
          `INSERT INTO packs (slug, name, notes, image, nutrition_image, bartesian_url, help_url,
             shopify_product_id, shopify_variant_id, shopify_handle, gorgias_article_id,
             enabled, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [...values, ts, ts]
        );
        pid = queryOne("SELECT last_insert_rowid() AS id").id;
      }
      exec("DELETE FROM pack_items WHERE pack_id = ?", [pid]);
      for (const item of d.items || []) {
        const qty = Math.max(0, Number(item.qty) || 0);
        if (!qty) continue;
        exec("INSERT OR IGNORE INTO pack_items (pack_id, cocktail_id, qty) VALUES (?, ?, ?)", [
          pid, Number(item.cocktail_id), qty,
        ]);
      }
      syncItemBarcode("variety_pack", d.barcode, { packId: pid });
      await persist();
      return this.getPack(pid);
    },

    async setPackEnabled(id, enabled) {
      exec("UPDATE packs SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, nowIso(), id]);
      await persist();
    },

    listAllRimmersAdmin() {
      return query("SELECT * FROM rimmers ORDER BY name COLLATE NOCASE").map(rowToRimmer);
    },

    listAllPacksAdmin() {
      return query("SELECT * FROM packs ORDER BY name COLLATE NOCASE");
    },

    listCocktails({
      search = "",
      sort = "name",
      favoritesOnly = false,
      availableOnly = false,
      seasonalOnly = false,
      spirit = "",
    } = {}) {
      let sql = listSelect + " WHERE c.enabled = 1";
      const params = [];
      // Both checked = union (in-stock OR favorite); single check = that filter alone.
      if (favoritesOnly && availableOnly) sql += " AND (c.favorite = 1 OR c.quantity >= 1)";
      else if (favoritesOnly) sql += " AND c.favorite = 1";
      else if (availableOnly) sql += " AND c.quantity >= 1";
      if (seasonalOnly) sql += " AND c.seasonal = 1";
      if (spirit.trim()) {
        sql += ` AND EXISTS (
          SELECT 1 FROM cocktail_spirits cs
          JOIN spirits s ON s.id = cs.spirit_id
          WHERE cs.cocktail_id = c.id AND s.name = ? COLLATE NOCASE
        )`;
        params.push(spirit.trim());
      }
      if (search.trim()) {
        sql +=
          " AND (c.name LIKE ? OR c.description LIKE ? OR c.glassware LIKE ? OR c.garnish LIKE ?)";
        const q = "%" + search.trim() + "%";
        params.push(q, q, q, q);
      }

      const rows = query(sql, params).map(rowToCocktail);
      const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      rows.sort((a, b) => {
        if (sort === "quantity") return b.quantity - a.quantity || cmpName(a, b);
        if (sort === "quantity-asc") return a.quantity - b.quantity || cmpName(a, b);
        if (sort === "rating") {
          const ar = a.avg_rating == null ? -1 : a.avg_rating;
          const br = b.avg_rating == null ? -1 : b.avg_rating;
          return br - ar || cmpName(a, b);
        }
        if (sort === "spirit") {
          return (
            (a.primary_spirit || "").localeCompare(b.primary_spirit || "", undefined, {
              sensitivity: "base",
            }) || cmpName(a, b)
          );
        }
        if (sort === "name-desc") return cmpName(b, a);
        return cmpName(a, b);
      });
      return rows;
    },

    getCocktail(id) {
      const row = queryOne(listSelect + " WHERE c.id = ?", [id]);
      const c = rowToCocktail(row);
      if (!c) return null;
      c.spirits = query(
        `SELECT s.name FROM cocktail_spirits cs
         JOIN spirits s ON s.id = cs.spirit_id
         WHERE cs.cocktail_id = ? ORDER BY cs.sort_order`,
        [id]
      ).map((r) => r.name);
      return c;
    },

    packsForCocktail(cocktailId) {
      return query(
        `SELECT p.*, pi.qty AS pack_qty
         FROM packs p
         JOIN pack_items pi ON pi.pack_id = p.id
         WHERE pi.cocktail_id = ?
         ORDER BY p.name COLLATE NOCASE`,
        [cocktailId]
      );
    },

    listRimmers({ search = "", kind = "", favoritesOnly = false, availableOnly = false } = {}) {
      let sql = "SELECT * FROM rimmers WHERE enabled = 1";
      const params = [];
      // Match cocktails: In stock + Favorites together = union, either alone = that filter.
      if (favoritesOnly && availableOnly) sql += " AND (favorite = 1 OR quantity >= 1)";
      else if (favoritesOnly) sql += " AND favorite = 1";
      else if (availableOnly) sql += " AND quantity >= 1";
      if (kind.trim()) {
        sql += " AND kind = ? COLLATE NOCASE";
        params.push(kind.trim());
      }
      if (search.trim()) {
        sql += " AND (name LIKE ? OR description LIKE ? OR pairs_with LIKE ?)";
        const q = "%" + search.trim() + "%";
        params.push(q, q, q);
      }
      sql += " ORDER BY name COLLATE NOCASE";
      return query(sql, params).map(rowToRimmer);
    },

    getRimmer(id) {
      return rowToRimmer(queryOne("SELECT * FROM rimmers WHERE id = ?", [id]));
    },

    rimmersForCocktail(cocktailId) {
      return query(
        `SELECT r.*
         FROM rimmers r
         JOIN cocktail_rimmers cr ON cr.rimmer_id = r.id
         WHERE cr.cocktail_id = ?
         ORDER BY r.name COLLATE NOCASE`,
        [cocktailId]
      ).map(rowToRimmer);
    },

    cocktailsForRimmer(rimmerId) {
      return query(
        `SELECT c.id, c.name, c.slug, c.image, c.quantity, c.restock
         FROM cocktails c
         JOIN cocktail_rimmers cr ON cr.cocktail_id = c.id
         WHERE cr.rimmer_id = ?
         ORDER BY c.name COLLATE NOCASE`,
        [rimmerId]
      );
    },

    async adjustRimmerQuantity(rimmerId, delta, reason, barcode) {
      const row = queryOne("SELECT quantity, restock FROM rimmers WHERE id = ?", [rimmerId]);
      if (!row) throw new Error("Rimmer not found");
      const prev = Number(row.quantity) || 0;
      const next = Math.max(0, prev + Number(delta));
      const actual = next - prev;
      const restock = restockForTransition(prev, next, row.restock);
      exec("UPDATE rimmers SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?", [
        next, restock, nowIso(), rimmerId,
      ]);
      if (actual !== 0) {
        exec(
          "INSERT INTO inventory_log (rimmer_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
          [rimmerId, actual, reason || "", barcode || "", nowIso()]
        );
        logActivity({
          kind: actual < 0 ? "use" : "restock",
          rimmerId, delta: actual, detail: reason || "", barcode: barcode || "",
        });
      }
      await persist();
      return next;
    },

    getPackItems(packId) {
      return query(
        `SELECT c.id, c.name, c.slug, pi.qty
         FROM pack_items pi
         JOIN cocktails c ON c.id = pi.cocktail_id
         WHERE pi.pack_id = ?
         ORDER BY c.name COLLATE NOCASE`,
        [packId]
      );
    },

    listRatings(cocktailId) {
      return query(
        `SELECT r.*, p.name AS person_name
         FROM ratings r
         JOIN people p ON p.id = r.person_id
         WHERE r.cocktail_id = ?
         ORDER BY r.updated_at DESC`,
        [cocktailId]
      );
    },

    async upsertRating({ cocktailId, personId, stars, comment }) {
      const s = Math.max(1, Math.min(5, Number(stars) || 0));
      const ts = nowIso();
      const existing = queryOne(
        "SELECT id FROM ratings WHERE cocktail_id = ? AND person_id = ?",
        [cocktailId, personId]
      );
      if (existing) {
        exec(
          "UPDATE ratings SET stars = ?, comment = ?, updated_at = ? WHERE id = ?",
          [s, comment || "", ts, existing.id]
        );
      } else {
        exec(
          "INSERT INTO ratings (cocktail_id, person_id, stars, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [cocktailId, personId, s, comment || "", ts, ts]
        );
      }
      logActivity({
        kind: "rating", cocktailId, personId, stars: s,
        detail: comment || "", created_at: ts,
      });
      await persist();
    },

    async setFavorite(id, favorite) {
      exec("UPDATE cocktails SET favorite = ?, updated_at = ? WHERE id = ?", [
        favorite ? 1 : 0,
        nowIso(),
        id,
      ]);
      logActivity({
        kind: "favorite", cocktailId: id,
        detail: favorite ? "favorited" : "unfavorited",
      });
      await persist();
    },

    async setRimmerFavorite(id, favorite) {
      exec("UPDATE rimmers SET favorite = ?, updated_at = ? WHERE id = ?", [
        favorite ? 1 : 0, nowIso(), id,
      ]);
      logActivity({
        kind: "favorite", rimmerId: id,
        detail: favorite ? "favorited" : "unfavorited",
      });
      await persist();
    },

    listActivity({ limit = 200, cocktailId = null, rimmerId = null } = {}) {
      let sql = `SELECT a.*,
          c.name AS cocktail_name, c.slug AS cocktail_slug,
          r.name AS rimmer_name, r.slug AS rimmer_slug,
          p.name AS pack_name, p.slug AS pack_slug,
          pe.name AS person_name
        FROM activity_log a
        LEFT JOIN cocktails c ON c.id = a.cocktail_id
        LEFT JOIN rimmers r ON r.id = a.rimmer_id
        LEFT JOIN packs p ON p.id = a.pack_id
        LEFT JOIN people pe ON pe.id = a.person_id
        WHERE 1=1`;
      const params = [];
      if (cocktailId) { sql += " AND a.cocktail_id = ?"; params.push(cocktailId); }
      if (rimmerId) { sql += " AND a.rimmer_id = ?"; params.push(rimmerId); }
      sql += " ORDER BY a.created_at DESC, a.id DESC LIMIT ?";
      params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
      try { return query(sql, params); } catch (_) { return []; }
    },

    getActivity(id) {
      try {
        return (
          queryOne(
            `SELECT a.*,
               c.name AS cocktail_name, c.slug AS cocktail_slug,
               r.name AS rimmer_name, r.slug AS rimmer_slug,
               p.name AS pack_name, p.slug AS pack_slug,
               pe.name AS person_name
             FROM activity_log a
             LEFT JOIN cocktails c ON c.id = a.cocktail_id
             LEFT JOIN rimmers r ON r.id = a.rimmer_id
             LEFT JOIN packs p ON p.id = a.pack_id
             LEFT JOIN people pe ON pe.id = a.person_id
             WHERE a.id = ?`,
            [id]
          ) || null
        );
      } catch (_) {
        return null;
      }
    },

    /** Admin: permanently remove a history record (does not change quantities). */
    async deleteActivity(id) {
      exec("DELETE FROM activity_log WHERE id = ?", [id]);
      await persist();
    },

    /**
     * Admin: edit a history record's timestamp and (optionally) who used it.
     * personName: undefined = leave as-is, "" = clear to blank, otherwise the
     * name is matched to a Person (created if new) and stored as person_id —
     * never as free text — so renaming that Person shows the new name and
     * deleting them leaves the entry blank (LEFT JOIN yields no name).
     */
    async updateActivity(id, { createdAt, personName } = {}) {
      const row = queryOne("SELECT * FROM activity_log WHERE id = ?", [id]);
      if (!row) throw new Error("History record not found.");
      let created = row.created_at;
      if (createdAt != null && createdAt !== "") {
        const d = new Date(createdAt);
        if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time.");
        created = d.toISOString();
      }
      let personId = row.person_id != null ? row.person_id : null;
      if (personName !== undefined) {
        const trimmed = String(personName || "").trim();
        if (!trimmed) {
          personId = null;
        } else {
          const person = await this.addPerson(trimmed);
          personId = person ? person.id : null;
        }
      }
      exec("UPDATE activity_log SET created_at = ?, person_id = ? WHERE id = ?", [
        created,
        personId,
        id,
      ]);
      await persist();
      return this.getActivity(id);
    },

    listWishlist() {
      try {
        return query(
          `SELECT w.id, w.qty_wanted, w.created_at, w.updated_at,
             w.cocktail_id, w.rimmer_id,
             c.name AS cocktail_name, c.slug AS cocktail_slug,
             c.hero_image AS cocktail_hero, c.image AS cocktail_image,
             c.bartesian_url AS cocktail_url, c.quantity AS cocktail_qty,
             r.name AS rimmer_name, r.slug AS rimmer_slug, r.image AS rimmer_image,
             r.bartesian_url AS rimmer_url, r.quantity AS rimmer_qty
           FROM wishlist_items w
           LEFT JOIN cocktails c ON c.id = w.cocktail_id
           LEFT JOIN rimmers r ON r.id = w.rimmer_id
           ORDER BY COALESCE(c.name, r.name) COLLATE NOCASE`
        ).map((row) => ({
          ...row,
          qty_wanted: Number(row.qty_wanted) || 1,
          type: row.cocktail_id ? "cocktail" : "rimmer",
          name: row.cocktail_name || row.rimmer_name || "—",
          slug: row.cocktail_slug || row.rimmer_slug || "",
          image: row.cocktail_id
            ? row.cocktail_hero || row.cocktail_image || ""
            : row.rimmer_image || "",
          bartesian_url: row.cocktail_id ? row.cocktail_url || "" : row.rimmer_url || "",
          quantity: Number(row.cocktail_id ? row.cocktail_qty : row.rimmer_qty) || 0,
        }));
      } catch (_) { return []; }
    },

    async addToWishlist({ cocktailId = null, rimmerId = null, qty = 1 } = {}) {
      if (!cocktailId && !rimmerId) throw new Error("Item required");
      const existing = cocktailId
        ? queryOne("SELECT * FROM wishlist_items WHERE cocktail_id = ?", [cocktailId])
        : queryOne("SELECT * FROM wishlist_items WHERE rimmer_id = ?", [rimmerId]);
      const addQty = Math.max(1, Number(qty) || 1);
      let row;
      if (existing) {
        const nextQty = (Number(existing.qty_wanted) || 1) + addQty;
        exec("UPDATE wishlist_items SET qty_wanted = ?, updated_at = ? WHERE id = ?", [
          nextQty, nowIso(), existing.id,
        ]);
        row = queryOne("SELECT * FROM wishlist_items WHERE id = ?", [existing.id]);
      } else {
        exec(
          "INSERT INTO wishlist_items (cocktail_id, rimmer_id, qty_wanted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          [cocktailId || null, rimmerId || null, addQty, nowIso(), nowIso()]
        );
        row = queryOne("SELECT * FROM wishlist_items WHERE id = ?", [
          queryOne("SELECT last_insert_rowid() AS id").id,
        ]);
      }
      logActivity({
        kind: "wishlist_add", cocktailId, rimmerId,
        delta: addQty, detail: "qty_wanted " + (row ? row.qty_wanted : addQty),
      });
      await persist();
      return row;
    },

    async updateWishlistQty(wishlistId, qty) {
      const q = Math.max(1, Number(qty) || 1);
      exec("UPDATE wishlist_items SET qty_wanted = ?, updated_at = ? WHERE id = ?", [
        q, nowIso(), wishlistId,
      ]);
      await persist();
      return q;
    },

    async adjustWishlistQty(wishlistId, delta) {
      const row = queryOne("SELECT qty_wanted FROM wishlist_items WHERE id = ?", [wishlistId]);
      if (!row) return null;
      return this.updateWishlistQty(wishlistId, (Number(row.qty_wanted) || 1) + Number(delta));
    },

    async removeFromWishlist(wishlistId) {
      const row = queryOne("SELECT * FROM wishlist_items WHERE id = ?", [wishlistId]);
      exec("DELETE FROM wishlist_items WHERE id = ?", [wishlistId]);
      if (row) {
        logActivity({
          kind: "wishlist_remove",
          cocktailId: row.cocktail_id, rimmerId: row.rimmer_id, detail: "",
        });
      }
      await persist();
    },

    isOnWishlist({ cocktailId = null, rimmerId = null } = {}) {
      try {
        if (cocktailId) return !!queryOne("SELECT id FROM wishlist_items WHERE cocktail_id = ?", [cocktailId]);
        if (rimmerId) return !!queryOne("SELECT id FROM wishlist_items WHERE rimmer_id = ?", [rimmerId]);
      } catch (_) {}
      return false;
    },

    listRestock() {
      const cocktails = query(
        "SELECT * FROM cocktails WHERE restock = 1 AND enabled = 1 ORDER BY name COLLATE NOCASE"
      ).map(rowToCocktail).map((c) => ({ ...c, type: "cocktail" }));
      const rimmers = query(
        "SELECT * FROM rimmers WHERE restock = 1 AND enabled = 1 ORDER BY name COLLATE NOCASE"
      ).map(rowToRimmer).map((r) => ({ ...r, type: "rimmer" }));
      return cocktails.concat(rimmers).sort((a, b) => a.name.localeCompare(b.name));
    },

    async clearRestock({ cocktailId = null, rimmerId = null } = {}) {
      if (cocktailId) {
        exec("UPDATE cocktails SET restock = 0, updated_at = ? WHERE id = ?", [nowIso(), cocktailId]);
        logActivity({ kind: "restock_clear", cocktailId, detail: "removed from Restock" });
      } else if (rimmerId) {
        exec("UPDATE rimmers SET restock = 0, updated_at = ? WHERE id = ?", [nowIso(), rimmerId]);
        logActivity({ kind: "restock_clear", rimmerId, detail: "removed from Restock" });
      }
      await persist();
    },

    async adjustQuantity(cocktailId, delta, reason, barcode) {
      const row = queryOne("SELECT quantity, restock FROM cocktails WHERE id = ?", [cocktailId]);
      if (!row) throw new Error("Cocktail not found");
      const prev = Number(row.quantity) || 0;
      const next = Math.max(0, prev + Number(delta));
      const actual = next - prev;
      const restock = restockForTransition(prev, next, row.restock);
      exec("UPDATE cocktails SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?", [
        next, restock, nowIso(), cocktailId,
      ]);
      if (actual !== 0) {
        exec(
          "INSERT INTO inventory_log (cocktail_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
          [cocktailId, actual, reason || "", barcode || "", nowIso()]
        );
        logActivity({
          kind: actual < 0 ? "use" : "restock",
          cocktailId, delta: actual, detail: reason || "", barcode: barcode || "",
        });
      }
      await persist();
      return next;
    },

    findBarcode(code) {
      const trimmed = String(code || "")
        .trim()
        .replace(/\s+/g, "");
      if (!trimmed) return null;
      let row = queryOne("SELECT * FROM barcodes WHERE code = ?", [trimmed]);
      if (row) return row;
      // UPC-A ↔ EAN-13 (leading zero)
      if (/^\d{12}$/.test(trimmed)) {
        row = queryOne("SELECT * FROM barcodes WHERE code = ?", ["0" + trimmed]);
        if (row) return row;
      } else if (/^0\d{12}$/.test(trimmed)) {
        row = queryOne("SELECT * FROM barcodes WHERE code = ?", [trimmed.slice(1)]);
        if (row) return row;
      }
      return null;
    },

    findCocktailBySlug(slug) {
      if (!slug) return null;
      const row = queryOne("SELECT id FROM cocktails WHERE slug = ?", [slug]);
      return row ? this.getCocktail(row.id) : null;
    },

    listAllCocktails() {
      return query(listSelect + " ORDER BY c.name COLLATE NOCASE").map(rowToCocktail);
    },

    listPacks() {
      return query("SELECT * FROM packs ORDER BY name COLLATE NOCASE");
    },

    getPack(id) {
      return queryOne("SELECT * FROM packs WHERE id = ?", [id]);
    },

    listBarcodes() {
      return query(
        `SELECT b.*,
           c.name AS cocktail_name, c.slug AS cocktail_slug,
           p.name AS pack_name, p.slug AS pack_slug,
           r.name AS rimmer_name, r.slug AS rimmer_slug
         FROM barcodes b
         LEFT JOIN cocktails c ON c.id = b.cocktail_id
         LEFT JOIN packs p ON p.id = b.pack_id
         LEFT JOIN rimmers r ON r.id = b.rimmer_id
         ORDER BY b.kind, b.code`
      );
    },

    /**
     * Upsert a barcode association (admin).
     * kind: capsule | case | variety_pack | rimmer
     */
    async upsertBarcode({ code, kind, cocktailId, packId, rimmerId, caseQty }) {
      const trimmed = String(code || "").trim();
      if (!trimmed) throw new Error("Barcode required");
      if (!kind) throw new Error("Kind required");
      const existing = queryOne("SELECT id FROM barcodes WHERE code = ?", [trimmed]);
      const qty = Number(caseQty) || 8;
      if (existing) {
        exec(
          `UPDATE barcodes SET kind = ?, cocktail_id = ?, pack_id = ?, rimmer_id = ?, case_qty = ?
           WHERE code = ?`,
          [
            kind,
            cocktailId || null,
            packId || null,
            rimmerId || null,
            kind === "case" ? qty : kind === "capsule" || kind === "rimmer" ? 1 : 0,
            trimmed,
          ]
        );
      } else {
        exec(
          `INSERT INTO barcodes (code, kind, cocktail_id, pack_id, rimmer_id, case_qty)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            trimmed,
            kind,
            cocktailId || null,
            packId || null,
            rimmerId || null,
            kind === "case" ? qty : kind === "capsule" || kind === "rimmer" ? 1 : 0,
          ]
        );
      }
      logActivity({
        kind: "barcode", cocktailId, packId, rimmerId,
        detail: kind, barcode: trimmed,
      });
      await persist();
      return this.findBarcode(trimmed);
    },

    async deleteBarcode(code) {
      exec("DELETE FROM barcodes WHERE code = ?", [String(code || "").trim()]);
      await persist();
    },

    /**
     * Apply a resolved scan preview (confirm step).
     * Capsule/rimmer default −1; pass delta +1 to restock one.
     */
    async applyResolved(preview) {
      if (!preview || !preview.ok || !preview.proposed || !preview.proposed.length) {
        return { ok: false, error: (preview && preview.error) || "Nothing to apply." };
      }
      const code = preview.code || "";
      const changes = [];

      // Persist romkal-discovered capsule link so export can capture it
      if (preview.kind === "capsule" && preview.source === "romkal" && preview.proposed[0]) {
        const id = preview.proposed[0].id;
        if (!this.findBarcode(code)) {
          await this.upsertBarcode({
            code,
            kind: "capsule",
            cocktailId: id,
          });
        }
      }

      for (const row of preview.proposed) {
        if (row.type === "rimmer") {
          const next = await this.adjustRimmerQuantity(
            row.id,
            row.delta,
            row.delta < 0 ? "use_rimmer" : "restock_rimmer",
            code
          );
          changes.push({
            name: row.name,
            type: "rimmer",
            delta: row.delta,
            quantity: next,
          });
        } else {
          const reason =
            preview.kind === "case"
              ? "restock_case"
              : preview.kind === "variety_pack"
                ? "restock_pack"
                : row.delta < 0
                  ? "use_capsule"
                  : row.delta > 1
                    ? "Pack (+" + row.delta + ")"
                    : "restock_capsule";
          const next = await this.adjustQuantity(row.id, row.delta, reason, code);
          changes.push({
            name: row.name,
            type: "cocktail",
            delta: row.delta,
            quantity: next,
          });
        }
      }
      return { ok: true, kind: preview.kind, changes };
    },

    /**
     * Apply a barcode scan immediately (legacy helper).
     * Prefer resolve + applyResolved for confirm UX.
     */
    async applyBarcode(code, opts) {
      const barcodes = global.BartesianBarcodes;
      if (!barcodes) {
        return { ok: false, error: "Barcode module not loaded." };
      }
      const preview = barcodes.resolve(this, code, opts || {});
      return this.applyResolved(preview);
    },

    pickRandom({ spirit = "", favoritesOnly = false, availableOnly = true } = {}) {
      const list = this.listCocktails({
        spirit,
        favoritesOnly,
        availableOnly,
        sort: "name",
      });
      if (!list.length) return null;
      return list[Math.floor(Math.random() * list.length)];
    },

    exportSnapshot() {
      // Include disabled cocktails so barcode associations export fully
      const cocktails = this.listAllCocktails().map((c) => {
        const full = this.getCocktail(c.id);
        const capsule = queryOne(
          "SELECT code FROM barcodes WHERE cocktail_id = ? AND kind = 'capsule'",
          [c.id]
        );
        const caseRow = queryOne(
          "SELECT code, case_qty FROM barcodes WHERE cocktail_id = ? AND kind = 'case'",
          [c.id]
        );
        return {
          ...full,
          capsule_barcode: capsule ? capsule.code : "",
          case_barcode: caseRow ? caseRow.code : "",
          case_qty: caseRow ? caseRow.case_qty : full.case_qty != null ? full.case_qty : 8,
        };
      });
      const packs = this.listPacks().map((p) => {
        const barcode = queryOne(
          "SELECT code FROM barcodes WHERE pack_id = ? AND kind = 'variety_pack'",
          [p.id]
        );
        return {
          ...p,
          barcode: barcode ? barcode.code : "",
          items: this.getPackItems(p.id).map((i) => ({
            cocktail_slug: i.slug,
            qty: i.qty,
          })),
        };
      });
      const rimmers = this.listRimmers({}).map((r) => {
        const barcode = queryOne(
          "SELECT code FROM barcodes WHERE rimmer_id = ? AND kind = 'rimmer'",
          [r.id]
        );
        return {
          ...r,
          barcode: barcode ? barcode.code : "",
          cocktail_slugs: this.cocktailsForRimmer(r.id).map((c) => c.slug),
        };
      });
      return {
        people: this.listPeople(),
        cocktails,
        packs,
        rimmers,
        barcodes: this.listBarcodes(),
        activity: this.listActivity({ limit: 1000 }),
        wishlist: this.listWishlist().map((w) => ({
          cocktail_slug: w.cocktail_slug || "",
          rimmer_slug: w.rimmer_slug || "",
          qty_wanted: w.qty_wanted,
          created_at: w.created_at,
          updated_at: w.updated_at,
        })),
        ratings: query(
          `SELECT r.*, p.name AS person_name, c.slug AS cocktail_slug
           FROM ratings r
           JOIN people p ON p.id = r.person_id
           JOIN cocktails c ON c.id = r.cocktail_id
           ORDER BY c.slug, p.name`
        ),
      };
    },
  };

  global.BartesianDB = api;
})(window);
