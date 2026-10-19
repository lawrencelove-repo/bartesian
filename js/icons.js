(function (global) {
  /** Tiny line-art SVGs for cocktail garnish / pairing chips (book-style). */
  const ICONS = {
    lime: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 7v18M8.5 11.5l15 9M8.5 20.5l15-9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    orange: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 8c2 2 2 4 0 5M12 17h8M16 13v8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    coffee: `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="14" cy="12" rx="7" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 12v6c0 3.3 3.1 6 7 6s7-2.7 7-6v-6M21 13h2.5a3 3 0 0 1 0 6H21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
    mint: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 26V10M16 18c-4-5-8-6-10-5 2 4 6 7 10 8M16 18c4-5 8-6 10-5-2 4-6 7-10 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    salt: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 8h10l2 16H9L11 8z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="16" r="1" fill="currentColor"/><circle cx="18" cy="18" r="1" fill="currentColor"/><circle cx="15.5" cy="20.5" r="1" fill="currentColor"/></svg>`,
    pineapple: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6c2 2 3 4 3 5H13c0-1 1-3 3-5z" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="16" cy="20" rx="7" ry="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 16l10 8M11 24l10-8M16 12v16" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    cherry: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6c2 4 5 7 8 8M16 6c-1 5-4 9-8 11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="22" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="22" cy="20" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
    cinnamon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 6l2 20M15 6l2 20M19 6l2 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 10h14M9 22h14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    chocolate: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="9" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 16h18M16 9v14M11.5 9v14M20.5 9v14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    steak: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 14c0-4 4-7 9-7s9 3 9 7-3 10-9 10-9-5-9-10z" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="16" cy="15" rx="4" ry="3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    taco: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 18c0-6 4.5-11 10-11s10 5 10 11" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 18h16M10 14h3M14 12h4M19 14h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    seafood: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16c4-6 10-9 16-8-2 4-2 8 0 12-6 1-12-2-16-8z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="20" cy="14" r="1.3" fill="currentColor"/><path d="M6 16h6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    fruit: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="18" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="16" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M17 10c1-2 3-3 5-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    pie: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 14h20l-2 12H8L6 14z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 14c2-4 4-6 6-6s4 2 6 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
    glass: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6h12l-2 10c0 3-2 5-4 5s-4-2-4-5L10 6zM16 21v5M12 26h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    spirit: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 5h6v4l3 4v12a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V13l3-4V5z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 17h10" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
    star: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6l2.4 7.2H26l-6 4.4 2.3 7.2L16 20.8 9.7 24.8 12 17.6 6 13.2h7.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    generic: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  };

  const RULES = [
    [/lime|lemon|citrus|wedge|wheel|peel/i, "lime"],
    [/orange/i, "orange"],
    [/coffee|espresso|bean/i, "coffee"],
    [/mint|herb|basil/i, "mint"],
    [/salt|rim/i, "salt"],
    [/pineapple/i, "pineapple"],
    [/cherry|cherries/i, "cherry"],
    [/cinnamon|stick/i, "cinnamon"],
    [/chocolate|cocoa/i, "chocolate"],
    [/steak|beef|meat/i, "steak"],
    [/taco|mexican/i, "taco"],
    [/seafood|fish|shrimp|crab/i, "seafood"],
    [/fruit|salad|berry/i, "fruit"],
    [/pie|dessert|cake/i, "pie"],
    [/glass|coupe|rocks|highball|martini|margarita/i, "glass"],
    [/vodka|rum|tequila|whiskey|whisky|gin|spirit/i, "spirit"],
  ];

  function pickIconKey(label) {
    const text = String(label || "");
    for (const [re, key] of RULES) {
      if (re.test(text)) return key;
    }
    return "generic";
  }

  function splitItems(raw) {
    return String(raw || "")
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function iconSvg(key) {
    return ICONS[key] || ICONS.generic;
  }

  function chip(label) {
    const key = pickIconKey(label);
    return `<div class="icon-chip">
      <span class="icon-circle">${iconSvg(key)}</span>
      <span class="icon-chip-label">${String(label)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")}</span>
    </div>`;
  }

  function chipList(raw) {
    const items = splitItems(raw);
    if (!items.length) return "";
    return `<div class="icon-chip-list">${items.map(chip).join("")}</div>`;
  }

  global.BartesianIcons = {
    pickIconKey,
    splitItems,
    chipList,
    iconSvg,
  };
})(window);
