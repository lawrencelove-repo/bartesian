/**
 * History / activity display patterns.
 *
 * Edit the strings in PATTERNS to change how History rows read.
 * Placeholders:
 *   {kind} {delta} {abs_delta}
 *   {cocktail_name} {rimmer_name} {item_name}
 *   {pack_name} {person_name} {created_at}
 *   {stars} {detail} {barcode}
 *
 * Title = first line (row-title). Meta = second line (row-meta).
 * Empty placeholders and their surrounding separators are stripped.
 */
(function (global) {
  const PATTERNS = {
    // Capsules added from a variety pack / case pack (has pack_name)
    restock_pack: {
      title: "Added +{delta} · {item_name} — {pack_name}",
      meta: "{created_at} · {person_name}",
    },
    // Capsules added without a known pack (manual, capsule scan, etc.)
    restock: {
      title: "Added +{delta} · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    use: {
      title: "Used {abs_delta} · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    rating: {
      title: "Review · {item_name}{stars_suffix}",
      meta: "{created_at} · {person_name}",
    },
    favorite: {
      title: "Favorited · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    unfavorite: {
      title: "Unfavorited · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    wishlist_add: {
      title: "Added to Wishlist · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    wishlist_remove: {
      title: "Removed from Wishlist · {item_name}",
      meta: "{created_at} · {person_name}",
    },
    restock_clear: {
      title: "Removed from Restock · {item_name}",
      meta: "{created_at}",
    },
    barcode: {
      title: "Barcode linked · {item_name}",
      meta: "{created_at} · {barcode}",
    },
    default: {
      title: "{kind} · {item_name}",
      meta: "{created_at} · {person_name}",
    },
  };

  function formatWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /** Trim leftover separators when a placeholder was empty. */
  function clean(s) {
    return String(s || "")
      .replace(/\s*[·—–]\s*$/g, "")
      .replace(/^\s*[·—–]\s*/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function fill(template, vars) {
    let out = String(template || "");
    Object.keys(vars).forEach((key) => {
      const val = vars[key] == null ? "" : String(vars[key]);
      out = out.split("{" + key + "}").join(val);
    });
    return clean(out);
  }

  function varsFor(entry) {
    const delta = entry.delta != null ? Number(entry.delta) : null;
    const abs = delta != null ? Math.abs(delta) : "";
    const item =
      entry.cocktail_name || entry.rimmer_name || entry.pack_name || "";
    const stars = entry.stars != null ? Number(entry.stars) : null;
    return {
      kind: entry.kind || "Event",
      delta: delta != null ? String(delta) : "",
      abs_delta: abs !== "" ? String(abs) : "",
      cocktail_name: entry.cocktail_name || "",
      rimmer_name: entry.rimmer_name || "",
      item_name: item,
      pack_name: entry.pack_name || "",
      person_name: entry.person_name || "",
      created_at: formatWhen(entry.created_at),
      stars: stars != null ? String(stars) : "",
      stars_suffix: stars != null ? " " + stars + "★" : "",
      detail: entry.detail || "",
      barcode: entry.barcode || "",
    };
  }

  function patternKey(entry) {
    const kind = entry.kind || "";
    if (kind === "restock") {
      return entry.pack_name ? "restock_pack" : "restock";
    }
    if (kind === "favorite") {
      return entry.detail === "unfavorited" ? "unfavorite" : "favorite";
    }
    if (PATTERNS[kind]) return kind;
    return "default";
  }

  function formatActivity(entry) {
    const key = patternKey(entry);
    const pattern = PATTERNS[key] || PATTERNS.default;
    const vars = varsFor(entry);
    return {
      title: fill(pattern.title, vars),
      meta: fill(pattern.meta, vars),
      key,
    };
  }

  function activityLabel(entry) {
    return formatActivity(entry).title;
  }

  global.BartesianActivityTemplates = {
    PATTERNS,
    formatWhen,
    formatActivity,
    activityLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
