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
      "Image: " + (c.image || c.hero_image || c.marketing_image || ""),
      "Seasonal: " + (c.seasonal ? "1" : "0"),
      "Enabled: " + (c.enabled === 0 || c.enabled === false ? "0" : "1"),
      "Favorite: " + (c.favorite ? "1" : "0"),
      "Quantity: " + (Number(c.quantity) || 0),
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
      "Items:",
    ];
    (p.items || []).forEach((item) => {
      lines.push("\t" + item.cocktail_slug + ": " + item.qty);
    });
    lines.push("");
    return lines.join("\n");
  }

  function fileStem(name, fallback) {
    const base = String(name || fallback || "Item")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .replace(/^\d+/, "");
    return base || fallback || "Item";
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
    zip.file("ratings.json", JSON.stringify(snapshot.ratings || [], null, 2));
    zip.file("people.json", JSON.stringify(snapshot.people || [], null, 2));
    zip.file("barcodes.json", JSON.stringify(snapshot.barcodes || [], null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bartesian-exports.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function writeWithDirectoryPicker(snapshot) {
    if (!window.showDirectoryPicker) {
      throw new Error("Directory picker is not supported in this browser.");
    }
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    let cocktailsDir = dir;
    let packsDir = dir;
    try {
      if (dir.name !== "exports") {
        const exportsDir = await dir.getDirectoryHandle("exports", { create: true });
        cocktailsDir = await exportsDir.getDirectoryHandle("cocktails", { create: true });
        packsDir = await exportsDir.getDirectoryHandle("packs", { create: true });
      } else {
        cocktailsDir = await dir.getDirectoryHandle("cocktails", { create: true });
        packsDir = await dir.getDirectoryHandle("packs", { create: true });
      }
    } catch (_) {
      cocktailsDir = dir;
      packsDir = dir;
    }

    for (const c of snapshot.cocktails || []) {
      const handle = await cocktailsDir.getFileHandle(fileStem(c.name, c.slug) + ".txt", {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(cocktailToText(c));
      await writable.close();
    }
    for (const p of snapshot.packs || []) {
      const handle = await packsDir.getFileHandle(fileStem(p.name, p.slug) + ".txt", {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(packToText(p));
      await writable.close();
    }
  }

  async function exportAll(snapshot) {
    try {
      await writeWithDirectoryPicker(snapshot);
      return { mode: "directory" };
    } catch (err) {
      await downloadZip(snapshot);
      return { mode: "zip", error: String(err && err.message ? err.message : err) };
    }
  }

  global.BartesianExport = {
    cocktailToText,
    packToText,
    rimmerToText,
    exportAll,
    downloadZip,
  };
})(window);
