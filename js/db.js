(function (global) {
  const IDB_NAME = "bartesian-sqlite";
  const IDB_STORE = "kv";
  const DB_KEY = "database";
  const SCHEMA_VERSION = 5;

  const SEED_SQL = `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
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
        enabled, quantity, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        shopify_handle, gorgias_article_id, favorite, enabled, quantity,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      exec("INSERT OR IGNORE INTO people (name, created_at) VALUES (?, ?)", [
        person.name,
        nowIso(),
      ]);
    }
    const slugToId = {};
    for (const c of seed.cocktails || []) {
      if (!c.slug || !c.name) continue;
      slugToId[c.slug] = insertCocktail(c);
    }
    for (const r of seed.rimmers || []) {
      if (!r.slug || !r.name) continue;
      insertRimmer(r, slugToId);
    }
    for (const p of seed.packs || []) {
      if (!p.slug || !p.name) continue;
      insertPack(p, slugToId);
    }
  }

  function createFreshDb() {
    db = new SQL.Database();
    db.run("PRAGMA foreign_keys = ON");
    db.run(SEED_SQL);
    seedAll();
  }

  function rowToCocktail(row) {
    if (!row) return null;
    return {
      ...row,
      favorite: !!row.favorite,
      seasonal: !!row.seasonal,
      enabled: row.enabled === undefined || row.enabled === null ? true : !!row.enabled,
      quantity: Number(row.quantity) || 0,
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
      return query("SELECT * FROM people ORDER BY name COLLATE NOCASE");
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
      if (favoritesOnly) sql += " AND c.favorite = 1";
      if (availableOnly) sql += " AND c.quantity >= 1";
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

    listRimmers({ search = "", kind = "" } = {}) {
      let sql = "SELECT * FROM rimmers WHERE enabled = 1";
      const params = [];
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
        `SELECT c.id, c.name, c.slug, c.image
         FROM cocktails c
         JOIN cocktail_rimmers cr ON cr.cocktail_id = c.id
         WHERE cr.rimmer_id = ?
         ORDER BY c.name COLLATE NOCASE`,
        [rimmerId]
      );
    },

    async adjustRimmerQuantity(rimmerId, delta, reason, barcode) {
      const row = queryOne("SELECT quantity FROM rimmers WHERE id = ?", [rimmerId]);
      if (!row) throw new Error("Rimmer not found");
      const next = Math.max(0, (Number(row.quantity) || 0) + Number(delta));
      exec("UPDATE rimmers SET quantity = ?, updated_at = ? WHERE id = ?", [
        next,
        nowIso(),
        rimmerId,
      ]);
      exec(
        "INSERT INTO inventory_log (rimmer_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
        [rimmerId, Number(delta), reason || "", barcode || "", nowIso()]
      );
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
      await persist();
    },

    async setFavorite(id, favorite) {
      exec("UPDATE cocktails SET favorite = ?, updated_at = ? WHERE id = ?", [
        favorite ? 1 : 0,
        nowIso(),
        id,
      ]);
      await persist();
    },

    async adjustQuantity(cocktailId, delta, reason, barcode) {
      const row = queryOne("SELECT quantity FROM cocktails WHERE id = ?", [cocktailId]);
      if (!row) throw new Error("Cocktail not found");
      const next = Math.max(0, (Number(row.quantity) || 0) + Number(delta));
      exec("UPDATE cocktails SET quantity = ?, updated_at = ? WHERE id = ?", [
        next,
        nowIso(),
        cocktailId,
      ]);
      exec(
        "INSERT INTO inventory_log (cocktail_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
        [cocktailId, Number(delta), reason || "", barcode || "", nowIso()]
      );
      await persist();
      return next;
    },

    findBarcode(code) {
      const trimmed = String(code || "").trim();
      if (!trimmed) return null;
      return queryOne("SELECT * FROM barcodes WHERE code = ?", [trimmed]);
    },

    /**
     * Apply a barcode scan.
     * capsule → −1; case → +case_qty; variety_pack → + each pack item qty
     */
    async applyBarcode(code) {
      const bc = this.findBarcode(code);
      if (!bc) {
        return { ok: false, error: "Unknown barcode: " + code };
      }
      const changes = [];
      if (bc.kind === "capsule") {
        const next = await this.adjustQuantity(bc.cocktail_id, -1, "use_capsule", bc.code);
        const c = this.getCocktail(bc.cocktail_id);
        changes.push({ cocktail: c, delta: -1, quantity: next });
      } else if (bc.kind === "case") {
        const qty = Number(bc.case_qty) || 8;
        const next = await this.adjustQuantity(bc.cocktail_id, qty, "restock_case", bc.code);
        const c = this.getCocktail(bc.cocktail_id);
        changes.push({ cocktail: c, delta: qty, quantity: next });
      } else if (bc.kind === "variety_pack") {
        const items = this.getPackItems(bc.pack_id);
        for (const item of items) {
          const next = await this.adjustQuantity(item.id, item.qty, "restock_pack", bc.code);
          changes.push({
            cocktail: this.getCocktail(item.id),
            delta: item.qty,
            quantity: next,
          });
        }
      } else {
        return { ok: false, error: "Unsupported barcode kind: " + bc.kind };
      }
      return { ok: true, kind: bc.kind, changes };
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
      const cocktails = this.listCocktails({ sort: "name" }).map((c) => {
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
          case_qty: caseRow ? caseRow.case_qty : 8,
        };
      });
      const packs = query("SELECT * FROM packs ORDER BY name COLLATE NOCASE").map((p) => {
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
