/**
 * Bartesian barcode decode + inventory resolve.
 *
 * Capsule lid encoding documented by romkal:
 * https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md
 *
 * Lookup order:
 *  1) Local barcodes table (case / variety / rimmer / manually linked capsule)
 *  2) romkal pods_data map (numeric Code128-C payload → cocktail name/slug)
 */
(function (global) {
  const GLASS = {
    0: "Lowball",
    1: "Highball",
    2: "Shaker",
  };

  function normalizeCode(code) {
    return String(code || "")
      .trim()
      .replace(/\s+/g, "");
  }

  function kindLabel(kind) {
    switch (kind) {
      case "capsule":
        return "Capsule";
      case "case":
        return "Case (single flavor)";
      case "variety_pack":
        return "Variety pack / case";
      case "rimmer":
        return "Rimmer";
      default:
        return kind || "Unknown";
    }
  }

  function upcAChecksumOk(digits12) {
    if (!digits12 || digits12.length !== 12) return false;
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      sum += digits12[i] * (i % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === digits12[11];
  }

  function ean13ChecksumOk(digits13) {
    if (!digits13 || digits13.length !== 13) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += digits13[i] * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10 === digits13[12];
  }

  /**
   * Distinguish retail UPC-A/EAN-13 from Bartesian capsule payloads.
   * New UPC → suggest Kind "case" (variety pack still needs a manual pick).
   */
  function classifyCode(code) {
    const normalized = normalizeCode(code);
    if (!normalized) {
      return { format: "unknown", suggestedKind: null, label: "Unknown" };
    }

    if (/^\d{12}$/.test(normalized)) {
      const digits = normalized.split("").map(Number);
      if (upcAChecksumOk(digits)) {
        return {
          format: "upc_a",
          suggestedKind: "case",
          label: "UPC-A (retail)",
        };
      }
    }
    if (/^\d{13}$/.test(normalized)) {
      const digits = normalized.split("").map(Number);
      if (ean13ChecksumOk(digits)) {
        return {
          format: "ean_13",
          suggestedKind: "case",
          label: "EAN-13 (retail)",
        };
      }
    }

    // Bartesian Code128-C payload is ≤10 digits; decodeCapsule validates range.
    const decoded = decodeCapsule(normalized);
    if (decoded) {
      return {
        format: "bartesian_capsule",
        suggestedKind: "capsule",
        label: "Bartesian capsule (Code128)",
        decoded,
      };
    }

    return { format: "unknown", suggestedKind: null, label: "Unknown" };
  }

  /**
   * Decode a Bartesian capsule numeric payload (bits per BARCODES.md).
   * @param {string|number} code
   * @returns {object|null}
   */
  function decodeCapsule(code) {
    const normalized = normalizeCode(code);
    if (!/^\d{1,10}$/.test(normalized)) return null;
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0 || n > 9999999999) return null;

    // Bit 0 should be 1 for real pods; still decode if missing (older/partial codes).
    const glassBits = (n >>> 1) & 0b11;
    const water = (n >>> 3) & 0b11111;
    const spirits = [];
    if (n & (1 << 8)) spirits.push("Gin");
    if (n & (1 << 9)) spirits.push("Rum");
    if (n & (1 << 10)) spirits.push("Vodka");
    if (n & (1 << 11)) spirits.push("Tequila");
    if (n & (1 << 12)) spirits.push("Whiskey");
    const drinkId = (n >>> 22) & 0b111111111;

    const map = (global.BARTESIAN_PODS_BARCODE_MAP && global.BARTESIAN_PODS_BARCODE_MAP.byCode) || {};
    const hit = map[String(n)] || map[normalized] || null;

    return {
      code: normalized,
      numeric: n,
      glass: GLASS[glassBits] || "Unknown",
      glassBits,
      waterUnits: water,
      spirits,
      drinkId,
      romkalName: hit ? hit.name : "",
      slug: hit && hit.slug ? hit.slug : "",
      knownPod: !!hit,
    };
  }

  function cocktailBySlug(db, slug) {
    if (!slug || !db.findCocktailBySlug) return null;
    return db.findCocktailBySlug(slug);
  }

  /**
   * Build a non-mutating preview of what applying this barcode would do.
   */
  function resolve(db, code, opts) {
    const normalized = normalizeCode(code);
    const capsuleDelta = opts && opts.capsuleDelta != null ? Number(opts.capsuleDelta) : -1;
    const rimmerDelta = opts && opts.rimmerDelta != null ? Number(opts.rimmerDelta) : -1;

    if (!normalized) {
      return { ok: false, error: "Enter a barcode." };
    }

    const classified = classifyCode(normalized);
    const decoded =
      classified.decoded ||
      (classified.format === "bartesian_capsule" ? decodeCapsule(normalized) : null) ||
      decodeCapsule(normalized);
    const bc = db.findBarcode(normalized);

    // 1) Explicit DB mapping wins (covers case / pack / rimmer / overrides)
    if (bc) {
      const mapped = resolveMapped(db, bc, normalized, decoded, capsuleDelta, rimmerDelta);
      if (mapped && typeof mapped === "object") {
        mapped.format = classified.format;
        mapped.formatLabel = classified.label;
      }
      return mapped;
    }

    // 2) Capsule via romkal drink map
    if (decoded && decoded.slug) {
      const c = cocktailBySlug(db, decoded.slug);
      if (c) {
        const delta = capsuleDelta >= 0 ? 1 : -1;
        return {
          ok: true,
          code: normalized,
          kind: "capsule",
          kindLabel: kindLabel("capsule"),
          targetName: c.name,
          adjustable: true,
          delta,
          source: "romkal",
          format: "bartesian_capsule",
          formatLabel: classified.label,
          suggestedKind: "capsule",
          decoded,
          proposed: [
            {
              type: "cocktail",
              id: c.id,
              name: c.name,
              slug: c.slug,
              image: c.hero_image || c.image || "",
              current: c.quantity,
              delta,
              next: Math.max(0, c.quantity + delta),
            },
          ],
        };
      }
    }

    // 3) Decodable but unknown drink — help admin associate
    if (decoded && classified.format === "bartesian_capsule") {
      return {
        ok: false,
        unknown: true,
        code: normalized,
        decoded,
        format: classified.format,
        formatLabel: classified.label,
        suggestedKind: "capsule",
        error: decoded.romkalName
          ? `Known pod “${decoded.romkalName}” is not in the local catalog yet.`
          : "Unknown capsule code — associate it in Admin → Barcodes (Drink ID " +
            decoded.drinkId +
            ").",
      };
    }

    if (classified.format === "upc_a" || classified.format === "ean_13") {
      return {
        ok: false,
        unknown: true,
        code: normalized,
        format: classified.format,
        formatLabel: classified.label,
        suggestedKind: "case",
        error:
          "Unknown " +
          classified.label +
          " — likely a case label. Associate it in Admin → Barcodes (Kind defaults to Case; switch to Variety pack if needed).",
      };
    }

    return {
      ok: false,
      unknown: true,
      code: normalized,
      format: classified.format,
      formatLabel: classified.label,
      suggestedKind: classified.suggestedKind,
      error: "Unknown barcode — associate it in Admin → Barcodes.",
    };
  }

  function resolveMapped(db, bc, normalized, decoded, capsuleDelta, rimmerDelta) {
    const proposed = [];

    if (bc.kind === "capsule") {
      const c = db.getCocktail(bc.cocktail_id);
      if (!c) return { ok: false, error: "Barcode points to a missing cocktail." };
      const delta = capsuleDelta >= 0 ? 1 : -1;
      proposed.push({
        type: "cocktail",
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.hero_image || c.image || "",
        current: c.quantity,
        delta,
        next: Math.max(0, c.quantity + delta),
      });
      return {
        ok: true,
        code: normalized,
        kind: bc.kind,
        kindLabel: kindLabel(bc.kind),
        targetName: c.name,
        adjustable: true,
        delta,
        source: "local",
        decoded,
        proposed,
      };
    }

    if (bc.kind === "case") {
      const c = db.getCocktail(bc.cocktail_id);
      if (!c) return { ok: false, error: "Barcode points to a missing cocktail." };
      const delta = Number(bc.case_qty) || 8;
      proposed.push({
        type: "cocktail",
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.hero_image || c.image || "",
        current: c.quantity,
        delta,
        next: c.quantity + delta,
      });
      return {
        ok: true,
        code: normalized,
        kind: bc.kind,
        kindLabel: kindLabel(bc.kind),
        targetName: c.name,
        adjustable: false,
        source: "local",
        decoded,
        proposed,
      };
    }

    if (bc.kind === "variety_pack") {
      const pack = db.getPack(bc.pack_id);
      if (!pack) return { ok: false, error: "Barcode points to a missing pack." };
      const items = db.getPackItems(bc.pack_id);
      if (!items.length) {
        return { ok: false, error: "Pack has no cocktail items configured." };
      }
      for (const item of items) {
        const full = db.getCocktail(item.id);
        proposed.push({
          type: "cocktail",
          id: item.id,
          name: item.name,
          slug: item.slug,
          image: (full && (full.hero_image || full.image)) || "",
          current: full ? full.quantity : 0,
          delta: item.qty,
          next: (full ? full.quantity : 0) + item.qty,
        });
      }
      return {
        ok: true,
        code: normalized,
        kind: bc.kind,
        kindLabel: kindLabel(bc.kind),
        targetName: pack.name,
        adjustable: false,
        source: "local",
        decoded,
        proposed,
      };
    }

    if (bc.kind === "rimmer") {
      const r = db.getRimmer(bc.rimmer_id);
      if (!r) return { ok: false, error: "Barcode points to a missing rimmer." };
      const delta = rimmerDelta >= 0 ? 1 : -1;
      proposed.push({
        type: "rimmer",
        id: r.id,
        name: r.name,
        slug: r.slug,
        image: r.image || "",
        current: r.quantity,
        delta,
        next: Math.max(0, r.quantity + delta),
      });
      return {
        ok: true,
        code: normalized,
        kind: bc.kind,
        kindLabel: kindLabel(bc.kind),
        targetName: r.name,
        adjustable: true,
        delta,
        source: "local",
        decoded,
        proposed,
      };
    }

    return { ok: false, error: "Unsupported barcode kind: " + bc.kind };
  }

  global.BartesianBarcodes = {
    normalizeCode,
    kindLabel,
    decodeCapsule,
    classifyCode,
    resolve,
  };
})(window);
