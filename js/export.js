(function (global) {
  function cocktailToText(c) {
    const lines = [
      "Name: " + (c.name || ""),
      "Slug: " + (c.slug || ""),
      "Description: " + (c.description || ""),
      "Details: " + String(c.details || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n"),
      "Spirits: " + ((c.spirits || []).join(", ") || ""),
      "Glassware: " + (c.glassware || ""),
      "Garnish: " + (c.garnish || ""),
      "Pairs With: " + (c.pairs_with || ""),
      "Nutrition: " + (c.nutrition_json || ""),
      "Alcohol: " + (c.alcohol_json || ""),
      "Bartesian URL: " + (c.bartesian_url || ""),
      "Help URL: " + (c.help_url || ""),
      "Shopify Product ID: " + (c.shopify_product_id || ""),
      "Shopify Variant ID: " + (c.shopify_variant_id || ""),
      "Shopify Handle: " + (c.shopify_handle || ""),
      "Shopify SKU: " + (c.shopify_sku || ""),
      "Gorgias Article ID: " + (c.gorgias_article_id || ""),
      "Hero Image: " + (c.hero_image || ""),
      "Marketing Image: " + (c.marketing_image || ""),
      "Image Cut: " + (c.image_cut || "NA"),
      "Image: " + (c.image || c.hero_image || c.marketing_image || ""),
      "Seasonal: " + (c.seasonal ? "1" : "0"),
      "Enabled: " + (c.enabled === 0 || c.enabled === false ? "0" : "1"),
      "Favorite: " + (c.favorite ? "1" : "0"),
      "Quantity: " + (Number(c.quantity) || 0),
      "Restock: " + (c.restock ? "1" : "0"),
      "Capsule Barcode: " + (c.capsule_barcode || ""),
      "Case Barcode: " + (c.case_barcode || ""),
      "Case Qty: " + (c.case_qty != null ? c.case_qty : 8),
      "",
    ];
    return lines.join("\n");
  }

  function rimmerToText(r) {
    const lines = [
      "Name: " + (r.name || ""),
      "Slug: " + (r.slug || ""),
      "Description: " + (r.description || ""),
      "Kind: " + (r.kind || ""),
      "Pairs With: " + (r.pairs_with || ""),
      "Cocktail Slugs: " + ((r.cocktail_slugs || []).join(", ") || ""),
      "Bartesian URL: " + (r.bartesian_url || ""),
      "Help URL: " + (r.help_url || ""),
      "Shopify Product ID: " + (r.shopify_product_id || ""),
      "Shopify Variant ID: " + (r.shopify_variant_id || ""),
      "Shopify Handle: " + (r.shopify_handle || ""),
      "Gorgias Article ID: " + (r.gorgias_article_id || ""),
      "Image: " + (r.image || ""),
      "Nutrition Image: " + (r.nutrition_image || ""),
      "Barcode: " + (r.barcode || ""),
      "Quantity: " + (Number(r.quantity) || 0),
      "Restock: " + (r.restock ? "1" : "0"),
      "Favorite: " + (r.favorite ? "1" : "0"),
      "Enabled: " + (r.enabled === 0 || r.enabled === false ? "0" : "1"),
      "",
    ];
    return lines.join("\n");
  }

  function packToText(p) {
    const lines = [
      "Name: " + (p.name || ""),
      "Slug: " + (p.slug || ""),
      "Barcode: " + (p.barcode || ""),
      "Notes: " + (p.notes || ""),
      "Bartesian URL: " + (p.bartesian_url || ""),
      "Help URL: " + (p.help_url || ""),
      "Shopify Product ID: " + (p.shopify_product_id || ""),
      "Shopify Variant ID: " + (p.shopify_variant_id || ""),
      "Shopify Handle: " + (p.shopify_handle || ""),
      "Gorgias Article ID: " + (p.gorgias_article_id || ""),
      "Image: " + (p.image || ""),
      "Nutrition Image: " + (p.nutrition_image || ""),
      "Enabled: " + ((p.enabled === 0 || p.enabled === false) ? "0" : "1"),
      "Items:",
    ];
    (p.items || []).forEach((item) => {
      lines.push("\t" + item.cocktail_slug + ": " + item.qty);
    });
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Stable zip entry name from slug (preferred) or display name.
   * Import merges by slug into the existing data/ filename, so this does not
   * need to match git paths exactly — but it must be stable across exports.
   * Do not strip leading digits (that turned "19th Hole" into thHole.txt).
   */
  function fileStemFromSlug(slug) {
    const parts = String(slug || "")
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (!parts.length) return "";
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  }

  function fileStem(name, slug) {
    const fromSlug = fileStemFromSlug(slug);
    if (fromSlug) return fromSlug;
    const base = String(name || "Item")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "");
    return base || "Item";
  }

  /**
   * Portable JSON for git: slug/name keys only — never device SQLite row ids
   * (those remapping across phones/browsers caused huge false diffs).
   */
  function sanitizeActivity(rows) {
    return (rows || []).map((a) => ({
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
    }));
  }

  function sanitizePeople(rows) {
    return (rows || [])
      .map((p) => ({
        name: p.name || "",
        is_admin: !!(p.is_admin === true || p.is_admin === 1),
        created_at: p.created_at || "",
      }))
      .filter((p) => p.name);
  }

  function sanitizeRatings(rows) {
    return (rows || []).map((r) => ({
      stars: r.stars != null ? Number(r.stars) : null,
      comment: r.comment || r.detail || "",
      created_at: r.created_at || "",
      updated_at: r.updated_at || "",
      person_name: r.person_name || null,
      cocktail_slug: r.cocktail_slug || null,
    }));
  }

  function sanitizeBarcodes(rows) {
    return (rows || []).map((b) => ({
      code: b.code || "",
      kind: b.kind || "",
      case_qty: b.case_qty != null ? Number(b.case_qty) : 1,
      cocktail_name: b.cocktail_name || null,
      cocktail_slug: b.cocktail_slug || null,
      pack_name: b.pack_name || null,
      pack_slug: b.pack_slug || null,
      rimmer_name: b.rimmer_name || null,
      rimmer_slug: b.rimmer_slug || null,
    }));
  }

  function sanitizeWishlist(rows) {
    return (rows || []).map((w) => ({
      cocktail_slug: w.cocktail_slug || "",
      rimmer_slug: w.rimmer_slug || "",
      qty_wanted: Math.max(1, Number(w.qty_wanted) || 1),
      created_at: w.created_at || "",
      updated_at: w.updated_at || "",
    }));
  }

  async function downloadZip(snapshot) {
    if (!global.JSZip) throw new Error("JSZip not loaded");
    const zip = new JSZip();
    const cocktails = zip.folder("cocktails");
    const packs = zip.folder("packs");
    for (const c of snapshot.cocktails || []) {
      cocktails.file(fileStem(c.name, c.slug) + ".txt", cocktailToText(c));
    }
    for (const p of snapshot.packs || []) {
      packs.file(fileStem(p.name, p.slug) + ".txt", packToText(p));
    }
    const rimmers = zip.folder("rimmers");
    for (const r of snapshot.rimmers || []) {
      rimmers.file(fileStem(r.name, r.slug) + ".txt", rimmerToText(r));
    }
    zip.file("ratings.json", JSON.stringify(sanitizeRatings(snapshot.ratings), null, 2));
    zip.file("people.json", JSON.stringify(sanitizePeople(snapshot.people), null, 2));
    zip.file("barcodes.json", JSON.stringify(sanitizeBarcodes(snapshot.barcodes), null, 2));
    zip.file("activity.json", JSON.stringify(sanitizeActivity(snapshot.activity), null, 2));
    zip.file("wishlist.json", JSON.stringify(sanitizeWishlist(snapshot.wishlist), null, 2));
    // Book Mode layouts: prefer a form-filtered snapshot from the app so each
    // device export only updates that form factor on import.
    const book =
      snapshot.book && typeof snapshot.book === "object"
        ? snapshot.book
        : { version: 1, globals: {}, cocktails: {} };
    zip.file("book.json", JSON.stringify(book, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bartesian-exports.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay revoke — revoking immediately can cancel the download in some browsers
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportAll(snapshot) {
    // Always download the zip: the import script expects bartesian-exports.zip,
    // and the old folder-picker path silently wrote only cocktails/packs
    // .txt files (no rimmers / JSON) into a subfolder.
    await downloadZip(snapshot);
    return { mode: "zip" };
  }

  global.BartesianExport = {
    cocktailToText,
    packToText,
    rimmerToText,
    exportAll,
    downloadZip,
  };
})(window);
