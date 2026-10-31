/** Authenticated D1 mutation handlers for Bartesian inventory ops. */

const nowIso = () => new Date().toISOString();

async function first(db, sql, ...binds) {
  return db.prepare(sql).bind(...binds).first();
}

async function run(db, sql, ...binds) {
  return db.prepare(sql).bind(...binds).run();
}

async function all(db, sql, ...binds) {
  const result = await db.prepare(sql).bind(...binds).all();
  return result.results || [];
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeImageCut(v) {
  const s = String(v || "NA").toUpperCase();
  return ["NA", "LEFT", "RIGHT", "CENTER"].includes(s) ? s : "NA";
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

function restockForTransition(prev, next, current) {
  if (next > 0) return 0;
  if (prev > 0 && next === 0) return 1;
  return Number(current || 0) === 1 ? 1 : 0;
}

async function ensureSpirit(db, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  await run(db, "INSERT OR IGNORE INTO spirits (name) VALUES (?)", trimmed);
  const row = await first(db, "SELECT id FROM spirits WHERE name = ? COLLATE NOCASE", trimmed);
  return row ? row.id : null;
}

async function setCocktailSpirits(db, cocktailId, spiritNames) {
  await run(db, "DELETE FROM cocktail_spirits WHERE cocktail_id = ?", cocktailId);
  const names = (Array.isArray(spiritNames) ? spiritNames : String(spiritNames || "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  let order = 0;
  for (const name of names) {
    const sid = await ensureSpirit(db, name);
    if (!sid) continue;
    await run(
      db,
      "INSERT OR IGNORE INTO cocktail_spirits (cocktail_id, spirit_id, sort_order) VALUES (?, ?, ?)",
      cocktailId,
      sid,
      order++
    );
  }
}

async function syncItemBarcode(db, kind, code, refs) {
  const trimmed = String(code || "").trim();
  if (!trimmed) {
    if (kind === "capsule" || kind === "case") {
      await run(
        db,
        "DELETE FROM barcodes WHERE kind = ? AND cocktail_id = ?",
        kind,
        refs.cocktailId
      );
    } else if (kind === "rimmer") {
      await run(db, "DELETE FROM barcodes WHERE kind = 'rimmer' AND rimmer_id = ?", refs.rimmerId);
    } else if (kind === "variety_pack") {
      await run(db, "DELETE FROM barcodes WHERE kind = 'variety_pack' AND pack_id = ?", refs.packId);
    }
    return;
  }
  const existing = await first(db, "SELECT id, kind FROM barcodes WHERE code = ?", trimmed);
  if (existing && existing.kind !== kind) {
    throw new Error("Barcode already used as " + existing.kind);
  }
  if (existing) {
    await run(
      db,
      `UPDATE barcodes SET kind = ?, cocktail_id = ?, pack_id = ?, rimmer_id = ?, case_qty = ? WHERE code = ?`,
      kind,
      refs.cocktailId || null,
      refs.packId || null,
      refs.rimmerId || null,
      refs.caseQty != null ? Number(refs.caseQty) : kind === "case" ? 8 : 1,
      trimmed
    );
  } else {
    await run(
      db,
      `INSERT INTO barcodes (code, kind, cocktail_id, pack_id, rimmer_id, case_qty)
       VALUES (?, ?, ?, ?, ?, ?)`,
      trimmed,
      kind,
      refs.cocktailId || null,
      refs.packId || null,
      refs.rimmerId || null,
      refs.caseQty != null ? Number(refs.caseQty) : kind === "case" ? 8 : 1
    );
  }
}

async function logActivity(db, a) {
  let packId = a.packId != null ? Number(a.packId) : null;
  if (packId != null && Number.isNaN(packId)) packId = null;
  let packName = a.packName != null ? String(a.packName) : "";
  let packSlug = a.packSlug != null ? String(a.packSlug) : "";
  if (packId != null && (!packName || !packSlug)) {
    const pack = await first(db, "SELECT name, slug FROM packs WHERE id = ?", packId);
    if (pack) {
      if (!packName) packName = pack.name || "";
      if (!packSlug) packSlug = pack.slug || "";
    }
  }
  await run(
    db,
    `INSERT INTO activity_log
       (created_at, kind, cocktail_id, rimmer_id, pack_id, person_id, delta, stars, detail, barcode,
        logged_pack_name, logged_pack_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.created_at || nowIso(),
    a.kind || "event",
    a.cocktailId || null,
    a.rimmerId || null,
    packId,
    a.personId || null,
    a.delta != null ? Number(a.delta) : null,
    a.stars != null ? Number(a.stars) : null,
    a.detail || "",
    a.barcode || "",
    packName || "",
    packSlug || ""
  );
}

async function adjustQuantity(db, { cocktailId, delta, reason, barcode, packInfo }) {
  const row = await first(db, "SELECT quantity, restock FROM cocktails WHERE id = ?", cocktailId);
  if (!row) throw new Error("Cocktail not found");
  const prev = Number(row.quantity) || 0;
  const next = Math.max(0, prev + Number(delta));
  const actual = next - prev;
  const restock = restockForTransition(prev, next, row.restock);
  await run(
    db,
    "UPDATE cocktails SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?",
    next,
    restock,
    nowIso(),
    cocktailId
  );
  if (actual !== 0) {
    await run(
      db,
      "INSERT INTO inventory_log (cocktail_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
      cocktailId,
      actual,
      reason || "",
      barcode || "",
      nowIso()
    );
    await logActivity(db, {
      kind: actual < 0 ? "use" : "restock",
      cocktailId,
      delta: actual,
      detail: reason || "",
      barcode: barcode || "",
      packId: packInfo?.packId,
      packName: packInfo?.packName,
      packSlug: packInfo?.packSlug,
    });
  }
  return { quantity: next };
}

async function adjustRimmerQuantity(db, { rimmerId, delta, reason, barcode }) {
  const row = await first(db, "SELECT quantity, restock FROM rimmers WHERE id = ?", rimmerId);
  if (!row) throw new Error("Rimmer not found");
  const prev = Number(row.quantity) || 0;
  const next = Math.max(0, prev + Number(delta));
  const actual = next - prev;
  const restock = restockForTransition(prev, next, row.restock);
  await run(
    db,
    "UPDATE rimmers SET quantity = ?, restock = ?, updated_at = ? WHERE id = ?",
    next,
    restock,
    nowIso(),
    rimmerId
  );
  if (actual !== 0) {
    await run(
      db,
      "INSERT INTO inventory_log (rimmer_id, delta, reason, barcode, created_at) VALUES (?, ?, ?, ?, ?)",
      rimmerId,
      actual,
      reason || "",
      barcode || "",
      nowIso()
    );
    await logActivity(db, {
      kind: actual < 0 ? "use" : "restock",
      rimmerId,
      delta: actual,
      detail: reason || "",
      barcode: barcode || "",
    });
  }
  return { quantity: next };
}

async function addPerson(db, { name }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Name required");
  await run(db, "INSERT OR IGNORE INTO people (name, created_at) VALUES (?, ?)", trimmed, nowIso());
  return first(db, "SELECT * FROM people WHERE name = ? COLLATE NOCASE", trimmed);
}

export async function applyMutation(db, body) {
  const op = String(body?.op || "");
  switch (op) {
    case "adjustQuantity":
      return adjustQuantity(db, body);
    case "adjustRimmerQuantity":
      return adjustRimmerQuantity(db, body);
    case "upsertRating": {
      const cocktailId = Number(body.cocktailId);
      const personId = Number(body.personId);
      const s = Math.max(1, Math.min(5, Number(body.stars) || 0));
      const ts = nowIso();
      const existing = await first(
        db,
        "SELECT id FROM ratings WHERE cocktail_id = ? AND person_id = ?",
        cocktailId,
        personId
      );
      if (existing) {
        await run(
          db,
          "UPDATE ratings SET stars = ?, comment = ?, updated_at = ? WHERE id = ?",
          s,
          body.comment || "",
          ts,
          existing.id
        );
      } else {
        await run(
          db,
          "INSERT INTO ratings (cocktail_id, person_id, stars, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          cocktailId,
          personId,
          s,
          body.comment || "",
          ts,
          ts
        );
      }
      await logActivity(db, {
        kind: "rating",
        cocktailId,
        personId,
        stars: s,
        detail: body.comment || "",
        created_at: ts,
      });
      return { ok: true };
    }
    case "setFavorite": {
      await run(
        db,
        "UPDATE cocktails SET favorite = ?, updated_at = ? WHERE id = ?",
        body.favorite ? 1 : 0,
        nowIso(),
        body.id
      );
      await logActivity(db, {
        kind: "favorite",
        cocktailId: body.id,
        detail: body.favorite ? "favorited" : "unfavorited",
      });
      return { ok: true };
    }
    case "setRimmerFavorite": {
      await run(
        db,
        "UPDATE rimmers SET favorite = ?, updated_at = ? WHERE id = ?",
        body.favorite ? 1 : 0,
        nowIso(),
        body.id
      );
      await logActivity(db, {
        kind: "favorite",
        rimmerId: body.id,
        detail: body.favorite ? "favorited" : "unfavorited",
      });
      return { ok: true };
    }
    case "setCocktailEnabled":
      await run(
        db,
        "UPDATE cocktails SET enabled = ?, updated_at = ? WHERE id = ?",
        body.enabled ? 1 : 0,
        nowIso(),
        body.id
      );
      return { ok: true };
    case "setCocktailSeasonal":
      await run(
        db,
        "UPDATE cocktails SET seasonal = ?, updated_at = ? WHERE id = ?",
        body.seasonal ? 1 : 0,
        nowIso(),
        body.id
      );
      return { ok: true };
    case "setCocktailImageCut":
      await run(
        db,
        "UPDATE cocktails SET image_cut = ?, updated_at = ? WHERE id = ?",
        normalizeImageCut(body.imageCut),
        nowIso(),
        body.id
      );
      return { ok: true };
    case "setRimmerEnabled":
      await run(
        db,
        "UPDATE rimmers SET enabled = ?, updated_at = ? WHERE id = ?",
        body.enabled ? 1 : 0,
        nowIso(),
        body.id
      );
      return { ok: true };
    case "setPackEnabled":
      await run(
        db,
        "UPDATE packs SET enabled = ?, updated_at = ? WHERE id = ?",
        body.enabled ? 1 : 0,
        nowIso(),
        body.id
      );
      return { ok: true };
    case "updateRimmerDetails": {
      const trimmedName = String(body.name || "").trim();
      if (!trimmedName) throw new Error("Rimmer name is required.");
      await run(
        db,
        "UPDATE rimmers SET name = ?, kind = ?, updated_at = ? WHERE id = ?",
        trimmedName,
        String(body.kind || "").trim(),
        nowIso(),
        body.id
      );
      return { ok: true };
    }
    case "addPerson":
      return addPerson(db, body);
    case "renamePerson": {
      const trimmed = String(body.name || "").trim();
      if (!trimmed) throw new Error("Name required");
      const row = await first(db, "SELECT id, name FROM people WHERE id = ?", body.personId);
      if (!row) throw new Error("Person not found");
      const clash = await first(
        db,
        "SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id != ?",
        trimmed,
        body.personId
      );
      if (clash) throw new Error("Someone named “" + trimmed + "” already exists.");
      await run(db, "UPDATE people SET name = ? WHERE id = ?", trimmed, body.personId);
      return first(db, "SELECT * FROM people WHERE id = ?", body.personId);
    }
    case "deletePerson": {
      const row = await first(db, "SELECT id, name FROM people WHERE id = ?", body.personId);
      if (!row) throw new Error("Person not found");
      await run(db, "DELETE FROM people WHERE id = ?", body.personId);
      return { id: row.id, name: row.name };
    }
    case "setPersonAdmin": {
      await run(
        db,
        "UPDATE people SET is_admin = ? WHERE id = ?",
        body.isAdmin ? 1 : 0,
        body.personId
      );
      return first(db, "SELECT * FROM people WHERE id = ?", body.personId);
    }
    case "upsertBarcode": {
      await syncItemBarcode(db, body.kind, body.code, {
        cocktailId: body.cocktailId,
        packId: body.packId,
        rimmerId: body.rimmerId,
        caseQty: body.caseQty,
      });
      return { ok: true };
    }
    case "deleteBarcode":
      await run(db, "DELETE FROM barcodes WHERE code = ?", String(body.code || ""));
      return { ok: true };
    case "deleteActivity":
      await run(db, "DELETE FROM activity_log WHERE id = ?", body.id);
      return { ok: true };
    case "updateActivity": {
      const row = await first(db, "SELECT * FROM activity_log WHERE id = ?", body.id);
      if (!row) throw new Error("History record not found.");
      let created = row.created_at;
      if (body.createdAt != null && body.createdAt !== "") {
        const d = new Date(body.createdAt);
        if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time.");
        created = d.toISOString();
      }
      let personId = row.person_id != null ? row.person_id : null;
      if (body.personName !== undefined) {
        const trimmed = String(body.personName || "").trim();
        if (!trimmed) personId = null;
        else {
          const person = await addPerson(db, { name: trimmed });
          personId = person ? person.id : null;
        }
      }
      await run(
        db,
        "UPDATE activity_log SET created_at = ?, person_id = ? WHERE id = ?",
        created,
        personId,
        body.id
      );
      return { ok: true };
    }
    case "addToWishlist": {
      const cocktailId = body.cocktailId || null;
      const rimmerId = body.rimmerId || null;
      if (!cocktailId && !rimmerId) throw new Error("Item required");
      const existing = cocktailId
        ? await first(db, "SELECT * FROM wishlist_items WHERE cocktail_id = ?", cocktailId)
        : await first(db, "SELECT * FROM wishlist_items WHERE rimmer_id = ?", rimmerId);
      const addQty = Math.max(1, Number(body.qty) || 1);
      if (existing) {
        const nextQty = (Number(existing.qty_wanted) || 1) + addQty;
        await run(
          db,
          "UPDATE wishlist_items SET qty_wanted = ?, updated_at = ? WHERE id = ?",
          nextQty,
          nowIso(),
          existing.id
        );
      } else {
        await run(
          db,
          "INSERT INTO wishlist_items (cocktail_id, rimmer_id, qty_wanted, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          cocktailId,
          rimmerId,
          addQty,
          nowIso(),
          nowIso()
        );
      }
      await logActivity(db, {
        kind: "wishlist_add",
        cocktailId,
        rimmerId,
        delta: addQty,
        detail: "wishlist",
      });
      return { ok: true };
    }
    case "updateWishlistQty":
      await run(
        db,
        "UPDATE wishlist_items SET qty_wanted = ?, updated_at = ? WHERE id = ?",
        Math.max(1, Number(body.qty) || 1),
        nowIso(),
        body.wishlistId
      );
      return { ok: true };
    case "removeFromWishlist":
      await run(db, "DELETE FROM wishlist_items WHERE id = ?", body.wishlistId);
      return { ok: true };
    case "clearRestock": {
      if (body.cocktailId) {
        await run(
          db,
          "UPDATE cocktails SET restock = 0, updated_at = ? WHERE id = ?",
          nowIso(),
          body.cocktailId
        );
      }
      if (body.rimmerId) {
        await run(
          db,
          "UPDATE rimmers SET restock = 0, updated_at = ? WHERE id = ?",
          nowIso(),
          body.rimmerId
        );
      }
      return { ok: true };
    }
    case "saveBookCocktailTune": {
      const f = String(body.formFactor || "");
      const o = String(body.orientation || "");
      const cocktailId = Number(body.cocktailId);
      const ts = nowIso();
      await run(
        db,
        `INSERT INTO book_cocktail_layouts (cocktail_id, form_factor, orientation, x, y, scale, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cocktail_id, form_factor, orientation) DO UPDATE SET
           x=excluded.x, y=excluded.y, scale=excluded.scale, updated_at=excluded.updated_at`,
        cocktailId,
        f,
        o,
        Number(body.x) || 0,
        Number(body.y) || 0,
        Number(body.scale) || 1,
        ts
      );
      if (body.imageCut != null) {
        await run(
          db,
          `INSERT INTO book_cocktail_settings (cocktail_id, image_cut, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(cocktail_id) DO UPDATE SET image_cut=excluded.image_cut, updated_at=excluded.updated_at`,
          cocktailId,
          normalizeImageCut(body.imageCut),
          ts
        );
      }
      return { ok: true };
    }
    case "saveBookGlobalTune": {
      const f = String(body.formFactor || "");
      const o = String(body.orientation || "");
      await run(
        db,
        `INSERT INTO book_globals (form_factor, orientation, x, y, scale, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(form_factor, orientation) DO UPDATE SET
           x=excluded.x, y=excluded.y, scale=excluded.scale, updated_at=excluded.updated_at`,
        f,
        o,
        Number(body.x) || 0,
        Number(body.y) || 0,
        Number(body.scale) || 1,
        nowIso()
      );
      return { ok: true };
    }
    case "saveCocktail": {
      const d = body.data || {};
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Cocktail name is required.");
      const slug = slugify(d.slug) || slugify(name);
      if (!slug) throw new Error("Cocktail slug is required.");
      const clash = await first(db, "SELECT id FROM cocktails WHERE slug = ?", slug);
      const id = body.id ? Number(body.id) : null;
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const hero = String(d.hero_image || "");
      const marketing = String(d.marketing_image || "");
      const values = [
        slug,
        name,
        String(d.description || ""),
        String(d.details || ""),
        String(d.image || "") || hero || marketing,
        hero,
        marketing,
        normalizeImageCut(d.image_cut),
        String(d.glassware || ""),
        String(d.garnish || ""),
        String(d.pairs_with || ""),
        jsonField(d.nutrition_json),
        jsonField(d.alcohol_json),
        String(d.bartesian_url || ""),
        String(d.help_url || ""),
        String(d.shopify_product_id || ""),
        String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""),
        String(d.shopify_sku || ""),
        String(d.gorgias_article_id || ""),
        d.seasonal ? 1 : 0,
        d.favorite ? 1 : 0,
        d.enabled ? 1 : 0,
        Math.max(0, Number(d.quantity) || 0),
        d.restock ? 1 : 0,
      ];
      let cid = id;
      if (cid) {
        if (!(await first(db, "SELECT id FROM cocktails WHERE id = ?", cid)))
          throw new Error("Cocktail not found.");
        await run(
          db,
          `UPDATE cocktails SET slug=?, name=?, description=?, details=?, image=?, hero_image=?, marketing_image=?, image_cut=?,
             glassware=?, garnish=?, pairs_with=?, nutrition_json=?, alcohol_json=?, bartesian_url=?, help_url=?,
             shopify_product_id=?, shopify_variant_id=?, shopify_handle=?, shopify_sku=?, gorgias_article_id=?,
             seasonal=?, favorite=?, enabled=?, quantity=?, restock=?, updated_at=? WHERE id=?`,
          ...values,
          ts,
          cid
        );
      } else {
        await run(
          db,
          `INSERT INTO cocktails (slug, name, description, details, image, hero_image, marketing_image, image_cut,
             glassware, garnish, pairs_with, nutrition_json, alcohol_json, bartesian_url, help_url,
             shopify_product_id, shopify_variant_id, shopify_handle, shopify_sku, gorgias_article_id,
             seasonal, favorite, enabled, quantity, restock, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ...values,
          ts,
          ts
        );
        const row = await first(db, "SELECT last_insert_rowid() AS id");
        cid = row.id;
      }
      await setCocktailSpirits(db, cid, d.spirits);
      await run(db, "DELETE FROM cocktail_rimmers WHERE cocktail_id = ?", cid);
      for (const rid of d.rimmer_ids || []) {
        await run(
          db,
          "INSERT OR IGNORE INTO cocktail_rimmers (cocktail_id, rimmer_id) VALUES (?, ?)",
          cid,
          Number(rid)
        );
      }
      await syncItemBarcode(db, "capsule", d.capsule_barcode, { cocktailId: cid });
      await syncItemBarcode(db, "case", d.case_barcode, {
        cocktailId: cid,
        caseQty: d.case_qty,
      });
      return { id: cid };
    }
    case "saveRimmer": {
      const d = body.data || {};
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Rimmer name is required.");
      const slug = slugify(d.slug) || slugify(name);
      const clash = await first(db, "SELECT id FROM rimmers WHERE slug = ?", slug);
      const id = body.id ? Number(body.id) : null;
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const values = [
        slug,
        name,
        String(d.description || ""),
        String(d.image || ""),
        String(d.kind || ""),
        String(d.pairs_with || ""),
        String(d.nutrition_image || ""),
        String(d.bartesian_url || ""),
        String(d.help_url || ""),
        String(d.shopify_product_id || ""),
        String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""),
        String(d.gorgias_article_id || ""),
        d.favorite ? 1 : 0,
        d.enabled ? 1 : 0,
        Math.max(0, Number(d.quantity) || 0),
        d.restock ? 1 : 0,
      ];
      let rid = id;
      if (rid) {
        await run(
          db,
          `UPDATE rimmers SET slug=?, name=?, description=?, image=?, kind=?, pairs_with=?, nutrition_image=?,
             bartesian_url=?, help_url=?, shopify_product_id=?, shopify_variant_id=?, shopify_handle=?,
             gorgias_article_id=?, favorite=?, enabled=?, quantity=?, restock=?, updated_at=? WHERE id=?`,
          ...values,
          ts,
          rid
        );
      } else {
        await run(
          db,
          `INSERT INTO rimmers (slug, name, description, image, kind, pairs_with, nutrition_image,
             bartesian_url, help_url, shopify_product_id, shopify_variant_id, shopify_handle,
             gorgias_article_id, favorite, enabled, quantity, restock, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ...values,
          ts,
          ts
        );
        rid = (await first(db, "SELECT last_insert_rowid() AS id")).id;
      }
      await run(db, "DELETE FROM cocktail_rimmers WHERE rimmer_id = ?", rid);
      for (const cid of d.cocktail_ids || []) {
        await run(
          db,
          "INSERT OR IGNORE INTO cocktail_rimmers (cocktail_id, rimmer_id) VALUES (?, ?)",
          Number(cid),
          rid
        );
      }
      await syncItemBarcode(db, "rimmer", d.barcode, { rimmerId: rid });
      return { id: rid };
    }
    case "savePack": {
      const d = body.data || {};
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Pack name is required.");
      const slug = slugify(d.slug) || slugify(name);
      const clash = await first(db, "SELECT id FROM packs WHERE slug = ?", slug);
      const id = body.id ? Number(body.id) : null;
      if (clash && Number(clash.id) !== Number(id)) throw new Error("Slug “" + slug + "” is already in use.");
      const ts = nowIso();
      const values = [
        slug,
        name,
        String(d.notes || ""),
        String(d.image || ""),
        String(d.nutrition_image || ""),
        String(d.bartesian_url || ""),
        String(d.help_url || ""),
        String(d.shopify_product_id || ""),
        String(d.shopify_variant_id || ""),
        String(d.shopify_handle || ""),
        String(d.gorgias_article_id || ""),
        d.enabled ? 1 : 0,
      ];
      let pid = id;
      if (pid) {
        await run(
          db,
          `UPDATE packs SET slug=?, name=?, notes=?, image=?, nutrition_image=?, bartesian_url=?, help_url=?,
             shopify_product_id=?, shopify_variant_id=?, shopify_handle=?, gorgias_article_id=?,
             enabled=?, updated_at=? WHERE id=?`,
          ...values,
          ts,
          pid
        );
      } else {
        await run(
          db,
          `INSERT INTO packs (slug, name, notes, image, nutrition_image, bartesian_url, help_url,
             shopify_product_id, shopify_variant_id, shopify_handle, gorgias_article_id,
             enabled, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ...values,
          ts,
          ts
        );
        pid = (await first(db, "SELECT last_insert_rowid() AS id")).id;
      }
      await run(db, "DELETE FROM pack_items WHERE pack_id = ?", pid);
      for (const item of d.items || []) {
        const qty = Math.max(0, Number(item.qty) || 0);
        if (!qty) continue;
        await run(
          db,
          "INSERT OR IGNORE INTO pack_items (pack_id, cocktail_id, qty) VALUES (?, ?, ?)",
          pid,
          Number(item.cocktail_id),
          qty
        );
      }
      await syncItemBarcode(db, "variety_pack", d.barcode, { packId: pid });
      return { id: pid };
    }
    case "applyResolved": {
      const preview = body.preview || {};
      const code = preview.code || "";
      const changes = [];
      if (preview.kind === "capsule" && preview.source === "romkal" && preview.proposed?.[0]) {
        const id = preview.proposed[0].id;
        const existing = await first(db, "SELECT id FROM barcodes WHERE code = ?", code);
        if (!existing) {
          await syncItemBarcode(db, "capsule", code, { cocktailId: id });
        }
      }
      for (const row of preview.proposed || []) {
        if (row.type === "rimmer") {
          const result = await adjustRimmerQuantity(db, {
            rimmerId: row.id,
            delta: row.delta,
            reason: row.delta < 0 ? "use_rimmer" : "restock_rimmer",
            barcode: code,
          });
          changes.push({
            name: row.name,
            type: "rimmer",
            delta: row.delta,
            quantity: result.quantity,
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
          let packInfo = null;
          if (preview.kind === "variety_pack" && preview.packId) {
            packInfo = {
              packId: preview.packId,
              packName: preview.packName || preview.targetName || "",
              packSlug: preview.packSlug || "",
            };
          } else if (preview.kind === "case" || (reason && String(reason).indexOf("Pack (+") === 0)) {
            const base = row.name || row.slug || "Capsule";
            packInfo = {
              packId: null,
              packName: base + " Capsules",
              packSlug: slugify(base) + "-capsules",
            };
          }
          const result = await adjustQuantity(db, {
            cocktailId: row.id,
            delta: row.delta,
            reason,
            barcode: code,
            packInfo,
          });
          changes.push({
            name: row.name,
            type: "cocktail",
            delta: row.delta,
            quantity: result.quantity,
          });
        }
      }
      return { ok: true, kind: preview.kind, changes };
    }
    default:
      throw new Error("Unknown mutation: " + op);
  }
}

export const SNAPSHOT_TABLES = [
  "meta",
  "people",
  "spirits",
  "cocktails",
  "cocktail_spirits",
  "rimmers",
  "cocktail_rimmers",
  "packs",
  "pack_items",
  "barcodes",
  "ratings",
  "inventory_log",
  "activity_log",
  "wishlist_items",
  "book_globals",
  "book_cocktail_layouts",
  "book_cocktail_settings",
];

export async function loadSnapshot(db) {
  const results = await Promise.all(
    SNAPSHOT_TABLES.map((name) => db.prepare("SELECT * FROM " + name).all())
  );
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((name, i) => [name, results[i].results || []])
  );
}
