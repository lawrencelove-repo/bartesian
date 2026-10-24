/**
 * Cocktail / rimmer / pack detail layout.
 *
 * Edit SECTIONS.*.order to rearrange blocks on the detail screens.
 * Edit SECTIONS.*.labels to rename headings (empty = no h2; hero uses title).
 *
 * Section ids are rendered by app.js — keep ids in sync if you add/remove ones.
 */
(function (global) {
  const SECTIONS = {
    cocktail: {
      /**
       * hero              — image, name, spirits, description, external links
       * detail_layout     — Description/Details/Alcohol + Best served / Garnish / Pairs
       * inventory         — qty, Use 1, favorites, wishlist, history
       * variety_packs     — packs that include this cocktail
       * recommended_rimmers — paired rimmers
       * ratings           — ratings list + add form
       * nutrition         — nutrition label image(s) / text
       */
      order: [
        "hero",
        "detail_layout",
        "inventory",
        "variety_packs",
        "recommended_rimmers",
        "ratings",
        "nutrition",
      ],
      labels: {
        hero: "",
        detail_layout: "",
        inventory: "Inventory",
        variety_packs: "Variety packs",
        recommended_rimmers: "Recommended rimmers",
        ratings: "Ratings &amp; comments",
        nutrition: "Nutrition",
      },
    },
    rimmer: {
      /**
       * hero              — image, kind, name, description, link
       * nutrition         — nutrition label image
       * inventory         — qty, favorites, wishlist, history
       * cocktail_pairings — cocktails that pair with this rimmer
       */
      order: ["hero", "nutrition", "inventory", "cocktail_pairings"],
      labels: {
        hero: "",
        nutrition: "Nutrition",
        inventory: "Inventory",
        cocktail_pairings: "Cocktail pairings",
      },
    },
    pack: {
      /**
       * hero              — image, name, notes, links
       * nutrition         — nutrition label image
       * pack_items        — cocktails included in the pack
       */
      order: ["hero", "nutrition", "pack_items"],
      labels: {
        hero: "",
        nutrition: "Nutrition",
        pack_items: "Included cocktails",
      },
    },
  };

  function sectionOrder(kind) {
    const s = SECTIONS[kind];
    return s && Array.isArray(s.order) ? s.order.slice() : [];
  }

  function sectionLabel(kind, id) {
    const s = SECTIONS[kind];
    if (!s || !s.labels) return "";
    return s.labels[id] != null ? s.labels[id] : "";
  }

  /** Wrap a named section; adds h2 when label is non-empty. */
  function wrapSection(kind, id, innerHtml) {
    if (!innerHtml) return "";
    const label = sectionLabel(kind, id);
    const heading = label ? `<h2>${label}</h2>` : "";
    return `<section class="item-section" data-item-section="${id}">${heading}${innerHtml}</section>`;
  }

  /** Render sections in template order from a map of id → html. */
  function renderSections(kind, parts) {
    return sectionOrder(kind)
      .map((id) => wrapSection(kind, id, parts[id] || ""))
      .join("\n");
  }

  global.BartesianItemTemplates = {
    SECTIONS,
    sectionOrder,
    sectionLabel,
    wrapSection,
    renderSections,
  };
})(typeof window !== "undefined" ? window : globalThis);
