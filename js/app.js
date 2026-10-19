(function () {
  /** Keep in sync with sw.js CACHE_VERSION */
  const APP_VERSION = "bartesian-v36";
  const LIST_PREFS_COOKIE = "bartesian_list_prefs";
  const ADMIN_COOKIE = "bartesian_admin";
  const USER_COOKIE = "bartesian_user";
  const CURRENT_USER = "Lawrence";
  const ALPHA_INDEX_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

  const root = document.getElementById("app");
  let currentRouteKey = "";
  const routeScrollPositions = new Map();
  let cameraScanner = null;
  let cameraTarget = null; // "scan" | "admin" | null
  let alphaScrubbing = false;
  let alphaScrollRaf = 0;

  const state = {
    search: "",
    sort: "name",
    spirit: "",
    favoritesOnly: false,
    availableOnly: false,
    rimmerSearch: "",
    rimmerKind: "",
    rimmerFavoritesOnly: false,
    rimmerAvailableOnly: false,
    qtyOpenKey: "",
    historyModal: null,
    flash: "",
    randomSpirit: "",
    randomFavoritesOnly: false,
    scanPreview: null,
    scanDelta: -1,
    adminCode: "",
    adminKind: "capsule",
    adminCocktailId: "",
    adminLookupNote: "",
    cameraOn: false,
    cameraStatus: "",
    isAdmin: false,
  };

  function getCookie(name) {
    const parts = document.cookie.split(";").map((p) => p.trim());
    for (const part of parts) {
      const i = part.indexOf("=");
      if (i === -1) continue;
      if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return "";
  }

  function setCookie(name, value, maxAgeSec) {
    const age = maxAgeSec != null ? maxAgeSec : 60 * 60 * 24 * 365;
    document.cookie =
      name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + age + "; SameSite=Lax";
  }

  function loadListPrefs() {
    try {
      const raw = getCookie(LIST_PREFS_COOKIE);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.search === "string") state.search = p.search;
      if (typeof p.sort === "string") state.sort = p.sort;
      if (typeof p.spirit === "string") state.spirit = p.spirit;
      if (typeof p.favoritesOnly === "boolean") state.favoritesOnly = p.favoritesOnly;
      if (typeof p.availableOnly === "boolean") state.availableOnly = p.availableOnly;
      // Migrate old Seasonal checkbox pref → Sort = Seasonal
      if (p.seasonalOnly === true && state.sort !== "seasonal") state.sort = "seasonal";
    } catch (_) {
      /* ignore bad cookie */
    }
  }

  function saveListPrefs() {
    setCookie(
      LIST_PREFS_COOKIE,
      JSON.stringify({
        search: state.search,
        sort: state.sort,
        spirit: state.spirit,
        favoritesOnly: state.favoritesOnly,
        availableOnly: state.availableOnly,
      })
    );
  }

  /** Seasonal lives in the Sort dropdown; translate it to a filter + A–Z order. */
  function listQuery() {
    const seasonal = state.sort === "seasonal";
    return {
      search: state.search,
      sort: seasonal ? "name" : state.sort,
      spirit: state.spirit,
      favoritesOnly: state.favoritesOnly,
      availableOnly: state.availableOnly,
      seasonalOnly: seasonal,
    };
  }

  loadListPrefs();

  function loadAdminFlag() {
    try {
      state.isAdmin = getCookie(ADMIN_COOKIE) === "1";
    } catch (_) {
      state.isAdmin = false;
    }
  }

  function saveAdminFlag() {
    setCookie(ADMIN_COOKIE, state.isAdmin ? "1" : "0");
    setCookie(USER_COOKIE, CURRENT_USER);
  }

  /** Admin is gated to Lawrence: cookie mirrors Lawrence's People is_admin flag. */
  function syncAdminFromDb() {
    try {
      const me = BartesianDB.findPersonByName(CURRENT_USER);
      if (me) {
        state.isAdmin = !!me.is_admin;
        saveAdminFlag();
      }
    } catch (_) {
      /* DB not ready */
    }
  }

  loadAdminFlag();

  function stopCamera() {
    if (cameraScanner) {
      cameraScanner.stop();
      cameraScanner = null;
    }
    cameraTarget = null;
    state.cameraOn = false;
    state.cameraStatus = "";
  }

  function applyAdminLookup(code) {
    const normalized = BartesianBarcodes.normalizeCode(code);
    state.adminCode = normalized;
    state.adminLookupNote = "";
    state.adminCocktailId = "";
    if (!normalized) {
      state.adminLookupNote = "Enter a barcode first.";
      return;
    }
    const classified = BartesianBarcodes.classifyCode(normalized);
    const decoded = classified.decoded || BartesianBarcodes.decodeCapsule(normalized);
    const existing = BartesianDB.findBarcode(normalized);
    if (existing) {
      state.adminKind = existing.kind;
      if (existing.cocktail_id) state.adminCocktailId = String(existing.cocktail_id);
      state.adminLookupNote =
        "Already saved as " + BartesianBarcodes.kindLabel(existing.kind) + ".";
      return;
    }
    if (classified.suggestedKind) {
      state.adminKind = classified.suggestedKind;
    }
    if (decoded && decoded.slug) {
      const c = BartesianDB.findCocktailBySlug(decoded.slug);
      state.adminKind = "capsule";
      if (c) {
        state.adminCocktailId = String(c.id);
        state.adminLookupNote =
          classified.label +
          ": romkal match " +
          decoded.romkalName +
          " → " +
          c.name +
          ". Save to link.";
      } else {
        state.adminLookupNote =
          classified.label +
          ": “" +
          decoded.romkalName +
          "” not in catalog. Pick cocktail, then Save.";
      }
      return;
    }
    if (decoded && classified.format === "bartesian_capsule") {
      state.adminKind = "capsule";
      state.adminLookupNote =
        classified.label +
        " (Drink ID " +
        decoded.drinkId +
        "). Pick cocktail, then Save.";
      return;
    }
    if (classified.format === "upc_a" || classified.format === "ean_13") {
      state.adminKind = "case";
      state.adminLookupNote =
        "Detected " +
        classified.label +
        ". Kind set to Case (single flavor) — switch to Variety pack if this is a multi-flavor box, then pick target and Save.";
      return;
    }
    state.adminLookupNote =
      "Could not classify barcode. Choose Kind + target, then Save.";
  }

  function applyScannedCode(code, target) {
    const normalized = BartesianBarcodes.normalizeCode(code);
    if (!normalized) return;
    if (target === "admin") {
      applyAdminLookup(normalized);
      stopCamera();
      render();
      return;
    }

    // Default: scan inventory page
    state.scanDelta = -1;
    state.scanPreview = BartesianBarcodes.resolve(BartesianDB, normalized, {
      capsuleDelta: state.scanDelta,
      rimmerDelta: state.scanDelta,
    });
    stopCamera();
    render();
    const box = root.querySelector("[data-scan-result]");
    if (box) box.innerHTML = scanPreviewHtml(state.scanPreview);
    const input = root.querySelector("[data-scan-lookup] input[name=code]");
    if (input) input.value = normalized;
  }

  async function startCamera(target) {
    stopCamera();
    cameraTarget = target;
    state.cameraOn = true;
    state.cameraStatus = "Starting camera…";
    render();
    const video = root.querySelector("[data-camera-video]");
    const canvas = root.querySelector("[data-camera-canvas]");
    if (!video || !canvas) {
      state.cameraOn = false;
      state.flash = "Camera UI missing.";
      render();
      return;
    }
    try {
      cameraScanner = BartesianCameraScan.createScanner({
        onCode: (code) => applyScannedCode(code, target),
        onStatus: (msg) => {
          state.cameraStatus = msg;
          const el = root.querySelector("[data-camera-status]");
          if (el) el.textContent = msg;
        },
        onError: (err) => {
          state.flash = String(err && err.message ? err.message : err);
        },
      });
      await cameraScanner.start(video, canvas);
      state.cameraOn = true;
    } catch (err) {
      stopCamera();
      state.flash =
        "Camera failed: " +
        (err && err.message ? err.message : err) +
        ". Use typed/USB entry, or allow camera permission.";
      render();
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length) return { view: "list" };
    if (parts[0] === "cocktail" && parts[1]) {
      return { view: "detail", id: Number(parts[1]) };
    }
    if (parts[0] === "rimmer" && parts[1]) {
      return { view: "rimmer-detail", id: Number(parts[1]) };
    }
    if (parts[0] === "rimmers") return { view: "rimmers" };
    if (parts[0] === "history" && (parts[1] === "cocktail" || parts[1] === "rimmer") && parts[2]) {
      return { view: "item-history", itemType: parts[1], id: Number(parts[2]) };
    }
    if (parts[0] === "history") return { view: "list" };
    if (parts[0] === "wishlist") return { view: "wishlist" };
    if (parts[0] === "restock") return { view: "restock" };
    if (parts[0] === "scan") return { view: "scan" };
    if (parts[0] === "random") return { view: "random" };
    if (parts[0] === "people") return { view: "people" };
    if (parts[0] === "settings") return { view: "settings" };
    if (parts[0] === "admin" && parts[1] === "barcodes") return { view: "admin-barcodes" };
    if (parts[0] === "admin" && parts[1] === "cocktails") return { view: "admin-cocktails" };
    if (parts[0] === "admin" && parts[1] === "rimmers") return { view: "admin-rimmers" };
    if (parts[0] === "admin" && parts[1] === "packs") return { view: "admin-packs" };
    if (parts[0] === "admin" && parts[1] === "people") return { view: "admin-people" };
    if (parts[0] === "admin" && parts[1] === "scan") return { view: "scan" };
    if (parts[0] === "admin") return { view: "admin-barcodes" };
    if (parts[0] === "disclaimer") return { view: "disclaimer" };
    return { view: "list" };
  }

  function go(href) {
    location.hash = href;
  }

  function starsLabel(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toFixed(1) + "★";
  }

  function parseJsonField(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  const ADMIN_VIEWS = [
    "scan", "admin-barcodes", "admin-cocktails", "admin-rimmers",
    "admin-packs", "admin-people", "people",
  ];

  function shell(active, body) {
    const nav = [
      ["list", "#/", "Cocktails"],
      ["rimmers", "#/rimmers", "Rimmers"],
      ["restock", "#/restock", "Restock"],
      ["wishlist", "#/wishlist", "Wishlist"],
      ["random", "#/random", "Random"],
      ["settings", "#/settings", "Settings"],
    ];
    const adminLinks = [
      ["scan", "#/admin/scan", "Scan"],
      ["admin-barcodes", "#/admin/barcodes", "Barcodes"],
      ["admin-cocktails", "#/admin/cocktails", "Cocktails"],
      ["admin-rimmers", "#/admin/rimmers", "Rimmers"],
      ["admin-packs", "#/admin/packs", "Packs"],
      ["admin-people", "#/admin/people", "People"],
    ];
    const adminActive = ADMIN_VIEWS.includes(active);
    const adminMenu = state.isAdmin
      ? `<details class="admin-menu">
          <summary class="topnav-link admin-summary ${adminActive ? "on" : ""}">Admin ▾</summary>
          <div class="admin-dropdown">
            ${adminLinks
              .map(
                ([key, href, label]) =>
                  `<a class="admin-dropdown-link ${active === key ? "on" : ""}" href="${href}" data-go="${href}">${label}</a>`
              )
              .join("")}
          </div>
        </details>`
      : "";
    return `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-row">
            <a class="brand" href="#/" data-go="#/">Bartesian</a>
            <nav class="topnav" aria-label="Primary">
              ${nav
                .map(
                  ([key, href, label]) =>
                    `<a class="topnav-link ${active === key ? "on" : ""}" href="${href}" data-go="${href}">${label}</a>`
                )
                .join("")}
              ${adminMenu}
            </nav>
          </div>
        </header>
        ${state.flash ? `<div class="flash" role="status">${esc(state.flash)}</div>` : ""}
        <main class="main">${body}</main>
        <footer class="footer">
          <a href="#/disclaimer" data-go="#/disclaimer">Disclaimer</a>
          <span>${esc(APP_VERSION)}</span>
          <span>Private use only · data in git, edits local until export</span>
        </footer>
      </div>
    `;
  }

  function listIndexKey(title) {
    const ch = String(title || "")
      .trim()
      .charAt(0)
      .toLocaleUpperCase();
    if (ch >= "A" && ch <= "Z") return ch;
    return "#";
  }

  function alphaIndexHtml(presentKeys) {
    const letters = ALPHA_INDEX_LETTERS.filter((letter) => presentKeys.has(letter));
    if (!letters.length) return "";
    return `<nav class="alpha-index" aria-label="Alphabetical index" data-alpha-index>
      ${letters
        .map(
          (letter) =>
            `<button type="button" class="alpha-index-letter has" data-act="jump-index" data-letter="${esc(letter)}">${esc(letter)}</button>`
        )
        .join("")}
    </nav>`;
  }

  function qtyBadgeClass(qty, restock) {
    const q = Number(qty) || 0;
    // Missing/null restock defaults to 0 (false)
    const flag = restock === true || restock === 1 || restock === "1";
    if (q <= 0) return flag ? "is-restock" : "is-zero";
    if (q === 1) return "is-low";
    return "";
  }

  /** Rimmers aren't consumed quickly: qty 1 stays black; red only at 0 + restock. */
  function rimmerQtyBadgeClass(qty, restock) {
    const q = Number(qty) || 0;
    const flag = restock === true || restock === 1 || restock === "1";
    if (q <= 0) return flag ? "is-restock" : "is-zero";
    return "";
  }

  function qtyKey(type, id) {
    return type + ":" + id;
  }

  function isQtyOpen(type, id) {
    return state.qtyOpenKey === qtyKey(type, id);
  }

  /** List-screen badge: tap to reveal −/+ steppers (only + when at 0). */
  function qtyControlsHtml(type, id, qty, restock, badgeClassFn) {
    const q = Number(qty) || 0;
    const cls = badgeClassFn(q, restock);
    const name = type === "rimmer" ? "rimmer" : "cocktail";
    if (!isQtyOpen(type, id)) {
      return `<button type="button" class="qty-badge ${cls}" data-qty-open="${qtyKey(type, id)}" aria-label="Quantity ${q}. Tap to adjust quantity">${q}</button>`;
    }
    return `<span class="qty-controls" data-qty-controls>
      ${q > 0 ? `<button type="button" class="qty-step" data-qty-step data-qty-type="${type}" data-id="${id}" data-delta="-1" aria-label="Decrease ${name} quantity by 1">−</button>` : ""}
      <span class="qty-badge ${cls}" aria-label="Quantity ${q}">${q}</span>
      <button type="button" class="qty-step" data-qty-step data-qty-type="${type}" data-id="${id}" data-delta="1" aria-label="Increase ${name} quantity by 1">+</button>
    </span>`;
  }

  function cocktailRowHtml(c, extraAttrs) {
    const spiritsText = (c.spirits_csv || "").split("|").filter(Boolean).join(", ");
    const thumb = primaryImage(c);
    const qty = Number(c.quantity) || 0;
    return `
      <a class="cocktail-row ${isQtyOpen("cocktail", c.id) ? "has-qty-open" : ""}" href="#/cocktail/${c.id}" data-go="#/cocktail/${c.id}" ${extraAttrs || ""}>
        ${qtyControlsHtml("cocktail", c.id, qty, c.restock, qtyBadgeClass)}
        <div class="thumb ${thumb ? "" : "thumb-empty"}">
          ${thumb ? `<img src="${esc(thumb)}" alt="">` : ""}
        </div>
        <div class="row-body">
          <div class="row-title">${esc(c.name)}${c.favorite ? " ★" : ""}${c.seasonal ? ' <span class="pill">Seasonal</span>' : ""}</div>
          <div class="row-meta">${esc(spiritsText || "—")} · ${starsLabel(c.avg_rating)}</div>
        </div>
      </a>
    `;
  }

  function orderCocktailsForIndex(cocktails) {
    if (state.sort === "name" || state.sort === "seasonal") {
      const letters = cocktails.filter((c) => listIndexKey(c.name) !== "#");
      const other = cocktails.filter((c) => listIndexKey(c.name) === "#");
      return letters.concat(other);
    }
    if (state.sort === "name-desc") {
      const letters = cocktails.filter((c) => listIndexKey(c.name) !== "#");
      const other = cocktails.filter((c) => listIndexKey(c.name) === "#");
      return other.concat(letters);
    }
    return cocktails;
  }

  function renderIndexedCocktailList(cocktails) {
    if (!cocktails.length) {
      return { html: `<p class="empty">No cocktails match.</p>`, present: new Set() };
    }
    const alphabetical =
      state.sort === "name" || state.sort === "name-desc" || state.sort === "seasonal";
    const ordered = alphabetical ? orderCocktailsForIndex(cocktails) : cocktails;
    const present = new Set();
    const seenAnchor = new Set();
    let lastKey = null;
    let html = "";

    for (const c of ordered) {
      const key = listIndexKey(c.name);
      present.add(key);
      if (alphabetical) {
        if (key !== lastKey) {
          html += `<div class="list-section" id="list-index-${key === "#" ? "num" : key}" data-index-key="${esc(key)}">${esc(key)}</div>`;
          lastKey = key;
        }
        html += cocktailRowHtml(c);
      } else {
        const attrs = !seenAnchor.has(key)
          ? `id="list-index-${key === "#" ? "num" : key}" data-index-key="${esc(key)}"`
          : "";
        seenAnchor.add(key);
        html += cocktailRowHtml(c, attrs);
      }
    }
    return { html, present };
  }

  function cocktailListShellHtml(cocktails) {
    const indexed = renderIndexedCocktailList(cocktails);
    return `<div class="list-shell">
      <div class="list">${indexed.html}</div>
      ${alphaIndexHtml(indexed.present)}
    </div>`;
  }

  function setActiveIndexLetter(letter) {
    const nav = root.querySelector("[data-alpha-index]");
    if (!nav || !letter) return;
    nav.querySelectorAll(".alpha-index-letter").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-letter") === letter);
    });
  }

  function jumpToIndexLetter(letter) {
    const id = letter === "#" ? "list-index-num" : "list-index-" + letter;
    const el =
      root.querySelector(
        "#" + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id)
      ) || root.querySelector('[data-index-key="' + letter + '"]');
    if (!el) return;
    // Page scroll only — no nested list scrollbar
    const top = el.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    setActiveIndexLetter(letter);
  }

  function letterFromIndexPointer(nav, clientY) {
    const buttons = [...nav.querySelectorAll(".alpha-index-letter")];
    if (!buttons.length) return "";
    const rect = nav.getBoundingClientRect();
    if (rect.height <= 0) return "";
    const ratio = (clientY - rect.top) / rect.height;
    const idx = Math.max(0, Math.min(buttons.length - 1, Math.floor(ratio * buttons.length)));
    return buttons[idx].getAttribute("data-letter") || "";
  }

  /** Highlight the rail letter for the section currently near the top of the viewport. */
  function syncAlphaIndexFromScroll() {
    const nav = root.querySelector("[data-alpha-index]");
    if (!nav) return;
    const markers = root.querySelectorAll("[data-index-key]");
    if (!markers.length) return;
    const probe = 96;
    let current = markers[0].getAttribute("data-index-key") || "";
    for (let i = 0; i < markers.length; i++) {
      const el = markers[i];
      if (el.getBoundingClientRect().top <= probe) {
        current = el.getAttribute("data-index-key") || current;
      } else {
        break;
      }
    }
    setActiveIndexLetter(current);
  }

  function scheduleAlphaIndexSync() {
    if (alphaScrubbing) return;
    if (alphaScrollRaf) return;
    alphaScrollRaf = requestAnimationFrame(() => {
      alphaScrollRaf = 0;
      syncAlphaIndexFromScroll();
    });
  }

  function renderList() {
    const cocktails = BartesianDB.listCocktails(listQuery());
    const spirits = BartesianDB.listSpirits();

    return shell(
      "list",
      `
      <section class="panel panel-list">
        <p class="section-label">Menu</p>
        <h1>Cocktails</h1>
        <form class="toolbar" data-list-filters>
          <div class="toolbar-controls">
            <input type="search" name="search" placeholder="Search" value="${esc(state.search)}" />
            <select name="spirit">
              <option value="">All spirits</option>
              ${spirits
                .map(
                  (s) =>
                    `<option value="${esc(s.name)}" ${state.spirit === s.name ? "selected" : ""}>${esc(s.name)}</option>`
                )
                .join("")}
            </select>
            <select name="sort">
              <option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option>
              <option value="name-desc" ${state.sort === "name-desc" ? "selected" : ""}>Name Z–A</option>
              <option value="quantity" ${state.sort === "quantity" ? "selected" : ""}>Quantity ↓</option>
              <option value="quantity-asc" ${state.sort === "quantity-asc" ? "selected" : ""}>Quantity ↑</option>
              <option value="rating" ${state.sort === "rating" ? "selected" : ""}>Rating</option>
              <option value="spirit" ${state.sort === "spirit" ? "selected" : ""}>Spirit</option>
              <option value="seasonal" ${state.sort === "seasonal" ? "selected" : ""}>Seasonal</option>
            </select>
          </div>
          <div class="toolbar-checks">
            <label class="check"><input type="checkbox" name="available" ${state.availableOnly ? "checked" : ""}/> In stock</label>
            <label class="check"><input type="checkbox" name="favorites" ${state.favoritesOnly ? "checked" : ""}/> Favorites</label>
          </div>
        </form>
        <p class="count">${cocktails.length} cocktail${cocktails.length === 1 ? "" : "s"}</p>
        ${cocktailListShellHtml(cocktails)}
      </section>
    `
    );
  }

  function alcoholBlock(alcohol, rawFallback) {
    if (!alcohol && !rawFallback) return "";
    if (alcohol && (alcohol.light_oz != null || alcohol.regular_oz != null)) {
      const rows = [
        ["Mocktail", alcohol.mocktail_oz],
        ["Light", alcohol.light_oz],
        ["Regular", alcohol.regular_oz],
        ["Strong", alcohol.strong_oz],
      ]
        .filter(([, v]) => v != null)
        .map(([label, v]) => `<li><strong>${label}</strong> — ${v} oz</li>`)
        .join("");
      return `<p class="section-label">Alcohol volume</p><ul class="plain">${rows}</ul>`;
    }
    const text = alcohol
      ? Object.entries(alcohol)
          .filter(([k]) => k !== "raw")
          .map(([k, v]) => k + ": " + v)
          .join(", ")
      : rawFallback;
    return text ? `<p class="section-label">Alcohol</p><p class="detail-copy">${esc(text)}</p>` : "";
  }

  function nutritionBlock(nutrition, rawFallback) {
    const labelImage = nutrition && nutrition.label_image;
    const euImage = nutrition && nutrition.label_image_eu;
    if (labelImage || euImage) {
      return `<section class="nutrition-section">
        <p class="section-label">Nutrition</p>
        <p class="detail-copy muted">Case label (nutrition, ingredients, UPC)</p>
        ${
          labelImage
            ? `<a class="nutrition-label" href="${esc(labelImage)}" target="_blank" rel="noopener">
                <img src="${esc(labelImage)}" alt="Nutrition label">
              </a>`
            : ""
        }
        ${
          euImage
            ? `<a class="nutrition-label" href="${esc(euImage)}" target="_blank" rel="noopener">
                <img src="${esc(euImage)}" alt="Nutrition label (EU)">
              </a>`
            : ""
        }
      </section>`;
    }
    if (!nutrition && !rawFallback) return "";
    const text = nutrition
      ? Object.entries(nutrition)
          .map(([k, v]) => k + ": " + v)
          .join(", ")
      : rawFallback;
    return text ? `<p class="section-label">Nutrition</p><p class="detail-copy">${esc(text)}</p>` : "";
  }

  function primaryImage(c) {
    return c.hero_image || c.marketing_image || c.image || "";
  }

  function detailsHtml(details) {
    const raw = String(details || "").trim();
    if (!raw) return "";
    return raw
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p class="detail-copy">${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function metaRow(label, value) {
    if (value == null || value === "") return "";
    return `<div class="meta-row">
      <span class="meta-mark" aria-hidden="true"></span>
      <div>
        <span class="label">${esc(label)}</span>
        <span class="value">${esc(value)}</span>
      </div>
    </div>`;
  }

  function renderDetail(id) {
    const c = BartesianDB.getCocktail(id);
    if (!c) {
      return shell("list", `<section class="panel"><p>Cocktail not found.</p></section>`);
    }
    const packs = BartesianDB.packsForCocktail(id);
    const rimmers = BartesianDB.rimmersForCocktail(id);
    const ratings = BartesianDB.listRatings(id);
    const people = BartesianDB.listPeople();
    const nutrition = parseJsonField(c.nutrition_json);
    const alcohol = parseJsonField(c.alcohol_json);
    const spiritsText = (c.spirits || []).join(", ") || "—";

    const packList = packs.length
      ? `<ul class="plain">${packs
          .map(
            (p) =>
              `<li>${esc(p.name)} <span class="muted">(×${p.pack_qty} in pack)</span></li>`
          )
          .join("")}</ul>`
      : `<p class="muted">Not in any variety packs (yet).</p>`;

    const rimmerList = rimmers.length
      ? `<div class="list rimmer-pair-list">${rimmers
          .map((r) => {
            const kind = (r.kind || "rimmer").replace(/^./, (c) => c.toUpperCase());
            return `
              <a class="cocktail-row" href="#/rimmer/${r.id}" data-go="#/rimmer/${r.id}">
                <span class="qty-badge ${rimmerQtyBadgeClass(Number(r.quantity) || 0, r.restock)}" aria-label="Quantity ${r.quantity}">${r.quantity}</span>
                <div class="thumb ${r.image ? "" : "thumb-empty"}">
                  ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
                </div>
                <div class="row-body">
                  <div class="row-title">${esc(r.name)}${r.favorite ? " ★" : ""}</div>
                  <div class="row-meta">${esc(kind)}</div>
                </div>
              </a>`;
          })
          .join("")}</div>`
      : "";

    const ratingRows = ratings.length
      ? ratings
          .map(
            (r) =>
              `<li><strong>${esc(r.person_name)}</strong> — ${r.stars}★${
                r.comment ? `: ${esc(r.comment)}` : ""
              }</li>`
          )
          .join("")
      : `<li class="muted">No ratings yet.</li>`;

    const heroSrc = c.hero_image || (!c.marketing_image ? c.image : "") || "";
    const marketingSrc = c.marketing_image || (!c.hero_image ? c.image : "") || "";
    // If only one photo exists, show it once at top.
    const topSrc = heroSrc || marketingSrc || primaryImage(c);
    const midSrc = heroSrc && marketingSrc && marketingSrc !== heroSrc ? marketingSrc : "";

    return shell(
      "list",
      `
      <section class="panel detail">
        <a class="back" href="#/" data-go="#/">← All cocktails</a>
        <div class="detail-hero">
          <div class="thumb large ${topSrc ? "" : "thumb-empty"}">
            ${topSrc ? `<img src="${esc(topSrc)}" alt="">` : ""}
          </div>
          <div>
            <p class="detail-kicker">Cocktail${c.seasonal ? " · Seasonal" : ""}</p>
            <h1 class="detail-title">${esc(c.name)}${c.favorite ? " ★" : ""}</h1>
            <p class="spirits">${esc(spiritsText)}</p>
            <p class="detail-copy">${esc(c.description || "")}</p>
            ${
              c.bartesian_url
                ? `<p><a href="${esc(c.bartesian_url)}" target="_blank" rel="noopener">View on Bartesian ↗</a></p>`
                : ""
            }
            ${
              c.help_url
                ? `<p class="muted"><a href="${esc(c.help_url)}" target="_blank" rel="noopener">Nutrition / help article ↗</a></p>`
                : ""
            }
          </div>
        </div>

        <div class="detail-layout">
          <div>
            <p class="section-label">Description</p>
            <p class="detail-copy">${esc(c.description || "No description yet.")}</p>
            ${
              c.details
                ? `<p class="section-label">Details</p>${detailsHtml(c.details)}`
                : ""
            }
            ${alcoholBlock(alcohol, c.alcohol_json)}
            ${
              midSrc
                ? `<p class="section-label">Product</p>
                   <div class="thumb large marketing-shot">
                     <img src="${esc(midSrc)}" alt="">
                   </div>`
                : ""
            }
          </div>
          <div>
            <p class="section-label">Best served with</p>
            <div class="meta-stack">
              ${metaRow("Base spirit", spiritsText)}
              ${metaRow("Glassware", c.glassware)}
              ${metaRow("Avg rating", starsLabel(c.avg_rating) + (c.rating_count ? ` (${c.rating_count})` : ""))}
            </div>
            ${
              c.garnish
                ? `<div class="chip-block"><p class="section-label">Garnish</p>${BartesianIcons.chipList(c.garnish)}</div>`
                : ""
            }
            ${
              c.pairs_with
                ? `<div class="chip-block"><p class="section-label">Pairs well with</p>${BartesianIcons.chipList(c.pairs_with)}</div>`
                : ""
            }
          </div>
        </div>

        <section class="inventory-box">
          <p class="section-label">Inventory</p>
          <p class="qty-display"><span data-qty>${c.quantity}</span> capsule${c.quantity === 1 ? "" : "s"}</p>
          <div class="qty-actions">
            <button type="button" data-qty-delta="-1" data-id="${c.id}">−</button>
            <button type="button" data-use-one data-id="${c.id}">Use 1</button>
            <button type="button" data-qty-delta="1" data-id="${c.id}">+</button>
            <button type="button" class="ghost" data-toggle-fav data-id="${c.id}" data-on="${c.favorite ? 1 : 0}">
              ${c.favorite ? "Remove from Favorites" : "Add to Favorites"}
            </button>
            <button type="button" class="ghost" data-wishlist-add-cocktail="${c.id}">Add to Wishlist</button>
            <button type="button" class="ghost" data-go="#/history/cocktail/${c.id}">History</button>
            ${c.restock && c.quantity === 0 ? '<span class="pill pill-restock">Restock needed</span>' : ""}
          </div>
        </section>

        <section>
          <h2>Variety packs</h2>
          ${packList}
        </section>

        ${
          rimmerList
            ? `<section><h2>Recommended rimmers</h2>${rimmerList}</section>`
            : ""
        }

        <section>
          <h2>Ratings &amp; comments</h2>
          <ul class="plain">${ratingRows}</ul>
          <form class="rating-form" data-rating-form data-id="${c.id}">
            <select name="person_id" required>
              <option value="">Person…</option>
              ${people
                .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
                .join("")}
            </select>
            <select name="stars" required>
              <option value="5">5★</option>
              <option value="4">4★</option>
              <option value="3">3★</option>
              <option value="2">2★</option>
              <option value="1">1★</option>
            </select>
            <input name="comment" type="text" placeholder="Comment (optional)" />
            <button type="submit">Save rating</button>
          </form>
        </section>

        ${nutritionBlock(nutrition, c.nutrition_json)}
      </section>
    `
    );
  }

  function renderRimmers() {
    const rimmers = BartesianDB.listRimmers({
      search: state.rimmerSearch,
      kind: state.rimmerKind,
      favoritesOnly: state.rimmerFavoritesOnly,
      availableOnly: state.rimmerAvailableOnly,
    });
    const rows = rimmers
      .map(
        (r) => `
          <div class="cocktail-row ${isQtyOpen("rimmer", r.id) ? "has-qty-open" : ""}">
            ${qtyControlsHtml("rimmer", r.id, r.quantity, r.restock, rimmerQtyBadgeClass)}
            <div class="thumb ${r.image ? "" : "thumb-empty"}">
              ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
            </div>
            <div class="row-body">
              <a class="row-body-link" href="#/rimmer/${r.id}" data-go="#/rimmer/${r.id}">
                <div class="row-title">${esc(r.name)}${r.favorite ? " ★" : ""}</div>
                <div class="row-meta">${esc((r.kind || "rimmer").replace(/^./, (c) => c.toUpperCase()))}</div>
              </a>
              <button type="button" class="ghost small fav-toggle" data-rimmer-toggle-fav data-id="${r.id}" data-on="${r.favorite ? 1 : 0}">
                ${r.favorite ? "Remove from Favorites" : "Add to Favorites"}
              </button>
            </div>
          </div>`
      )
      .join("");

    return shell(
      "rimmers",
      `
      <section class="panel">
        <p class="section-label">Barware</p>
        <h1>Rimmers</h1>
        <form class="toolbar" data-rimmer-filters>
          <input type="search" name="search" placeholder="Search" value="${esc(state.rimmerSearch)}" />
          <select name="kind">
            <option value="" ${!state.rimmerKind ? "selected" : ""}>All kinds</option>
            <option value="sugar" ${state.rimmerKind === "sugar" ? "selected" : ""}>Sugar</option>
            <option value="salt" ${state.rimmerKind === "salt" ? "selected" : ""}>Salt</option>
          </select>
          <label class="check"><input type="checkbox" name="available" ${state.rimmerAvailableOnly ? "checked" : ""}/> In stock</label>
          <label class="check"><input type="checkbox" name="favorites" ${state.rimmerFavoritesOnly ? "checked" : ""}/> Favorites</label>
        </form>
        <p class="count">${rimmers.length} rimmer${rimmers.length === 1 ? "" : "s"}</p>
        <div class="list">${rows || `<p class="empty">No rimmers match.</p>`}</div>
      </section>
    `
    );
  }

  function renderRimmerDetail(id) {
    const r = BartesianDB.getRimmer(id);
    if (!r) {
      return shell("rimmers", `<section class="panel"><p>Rimmer not found.</p></section>`);
    }
    const cocktails = BartesianDB.cocktailsForRimmer(id);
    const cocktailList = cocktails.length
      ? `<div class="list">${cocktails
          .map((c) => {
            const thumb = c.image || "";
            return `
              <a class="cocktail-row" href="#/cocktail/${c.id}" data-go="#/cocktail/${c.id}">
                <span class="qty-badge ${qtyBadgeClass(Number(c.quantity) || 0, c.restock)}" aria-label="Quantity ${c.quantity || 0}">${c.quantity || 0}</span>
                <div class="thumb ${thumb ? "" : "thumb-empty"}">
                  ${thumb ? `<img src="${esc(thumb)}" alt="">` : ""}
                </div>
                <div class="row-body">
                  <div class="row-title">${esc(c.name)}</div>
                </div>
              </a>`;
          })
          .join("")}</div>`
      : `<p class="muted">${esc(r.pairs_with || "No linked cocktails yet.")}</p>`;

    return shell(
      "rimmers",
      `
      <section class="panel detail">
        <a class="back" href="#/rimmers" data-go="#/rimmers">← All rimmers</a>
        <div class="detail-hero">
          <div class="thumb large ${r.image ? "" : "thumb-empty"}">
            ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
          </div>
          <div>
            <p class="detail-kicker">${esc((r.kind || "rimmer").replace(/^./, (c) => c.toUpperCase()))} rimmer</p>
            <h1 class="detail-title">${esc(r.name)}${r.favorite ? " ★" : ""}</h1>
            <p class="detail-copy">${esc(r.description || "")}</p>
            ${
              r.bartesian_url
                ? `<p><a href="${esc(r.bartesian_url)}" target="_blank" rel="noopener">View on Bartesian ↗</a></p>`
                : ""
            }
          </div>
        </div>
        ${
          r.nutrition_image
            ? `<p class="section-label">Nutrition</p>
               <a class="nutrition-label" href="${esc(r.nutrition_image)}" target="_blank" rel="noopener">
                 <img src="${esc(r.nutrition_image)}" alt="Nutrition label">
               </a>`
            : ""
        }
        <section class="inventory-box">
          <p class="section-label">Inventory</p>
          <p class="qty-display"><span data-qty>${r.quantity}</span> on hand</p>
          <div class="qty-actions">
            <button type="button" data-rimmer-qty-delta="-1" data-id="${r.id}">−</button>
            <button type="button" data-rimmer-qty-delta="1" data-id="${r.id}">+</button>
            <button type="button" class="ghost" data-rimmer-toggle-fav data-id="${r.id}" data-on="${r.favorite ? 1 : 0}">
              ${r.favorite ? "Remove from Favorites" : "Add to Favorites"}
            </button>
            <button type="button" class="ghost" data-wishlist-add-rimmer="${r.id}">Add to Wishlist</button>
            <button type="button" class="ghost" data-go="#/history/rimmer/${r.id}">History</button>
            ${r.restock && r.quantity === 0 ? '<span class="pill pill-restock">Restock needed</span>' : ""}
          </div>
        </section>
        <section>
          <h2>Cocktail pairings</h2>
          ${cocktailList}
        </section>
      </section>
    `
    );
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  function activityLabel(a) {
    const name = a.cocktail_name || a.rimmer_name || a.pack_name || "";
    switch (a.kind) {
      case "use":
        return (a.delta != null ? "Used " + Math.abs(Number(a.delta)) + " · " : "Used · ") + name +
          (a.person_name ? " — " + a.person_name : "");
      case "restock":
        return (a.delta != null ? "Added +" + Number(a.delta) + " · " : "Added · ") + name +
          (a.person_name ? " — " + a.person_name : "");
      case "rating":
        return "Feedback · " + name + (a.person_name ? " — " + a.person_name : "") +
          (a.stars ? " " + a.stars + "★" : "") + (a.detail ? ": " + a.detail : "");
      case "favorite":
        return (a.detail === "unfavorited" ? "Unfavorited · " : "Favorited · ") + name;
      case "barcode":
        return "Barcode linked · " + name + (a.barcode ? " (" + a.barcode + ")" : "");
      case "wishlist_add":
        return "Added to Wishlist · " + name;
      case "wishlist_remove":
        return "Removed from Wishlist · " + name;
      case "restock_clear":
        return "Removed from Restock · " + name;
      default:
        return (a.kind || "Event") + (name ? " · " + name : "");
    }
  }

  function activityRowsHtml(rows, emptyText) {
    if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
    return rows.map((a) => {
      const adminBtns = state.isAdmin
        ? `<div class="row-actions history-actions">
             <button type="button" class="ghost small" data-history-edit="${a.id}">Edit</button>
             <button type="button" class="ghost danger small" data-history-delete="${a.id}">Delete</button>
           </div>`
        : "";
      const inner = `
        <div class="row-body">
          <div class="row-title">${esc(activityLabel(a))}</div>
          <div class="row-meta">${esc(formatWhen(a.created_at))}${a.barcode && a.kind !== "barcode" ? " · " + esc(a.barcode) : ""}${a.detail && a.kind !== "rating" && a.kind !== "favorite" ? " · " + esc(a.detail) : ""}</div>
          ${adminBtns}
        </div>`;
      return `<div class="cocktail-row history-row"><span class="history-dot" aria-hidden="true"></span>${inner}</div>`;
    }).join("");
  }

  /** ISO timestamp → value for <input type="datetime-local"> (local time). */
  function toLocalInputValue(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes())
    );
  }

  function historyModalHtml(people) {
    const m = state.historyModal;
    if (!m) return "";
    if (m.mode === "delete") {
      return `<div class="modal-backdrop" data-history-modal-backdrop>
        <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="history-modal-title">
          <h2 id="history-modal-title">Delete history record?</h2>
          <p>${esc(m.label)}</p>
          <p class="muted">${esc(m.when)}</p>
          <p>This permanently removes the record. It does <strong>not</strong> change inventory quantities.</p>
          <div class="modal-actions">
            <button type="button" class="ghost" data-history-modal-close>Cancel</button>
            <button type="button" class="danger" data-history-delete-confirm="${m.id}">Delete permanently</button>
          </div>
        </div>
      </div>`;
    }
    const personField =
      m.kind === "use" || m.kind === "restock"
        ? `<label>${m.kind === "use" ? "Consumed / used by" : "Added by"} <span class="muted">(optional)</span>
             <input name="person_name" type="text" list="history-people-options" placeholder="Leave blank, or any name" value="${esc(m.personName || "")}" />
           </label>
           <datalist id="history-people-options">
             ${(people || []).map((p) => `<option value="${esc(p.name)}"></option>`).join("")}
           </datalist>
           <p class="hint">A new name is added as a Person. Clearing the field leaves it blank.</p>`
        : "";
    return `<div class="modal-backdrop" data-history-modal-backdrop>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
        <h2 id="history-modal-title">Edit history</h2>
        <p>${esc(m.label)}</p>
        <form class="modal-form" data-history-edit-form data-id="${m.id}">
          <label>Date &amp; time
            <input name="created_at" type="datetime-local" required value="${esc(m.createdLocal || "")}" />
          </label>
          ${personField}
          <div class="modal-actions">
            <button type="button" class="ghost" data-history-modal-close>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  function renderItemHistory(itemType, id) {
    const isCocktail = itemType === "cocktail";
    const item = isCocktail ? BartesianDB.getCocktail(id) : BartesianDB.getRimmer(id);
    if (!item) {
      return shell(isCocktail ? "list" : "rimmers", `<section class="panel"><p>Item not found.</p></section>`);
    }
    const rows = BartesianDB.listActivity(
      isCocktail ? { limit: 300, cocktailId: id } : { limit: 300, rimmerId: id }
    );
    const backHref = isCocktail ? "#/cocktail/" + id : "#/rimmer/" + id;
    const img = isCocktail ? primaryImage(item) : item.image || "";
    const people = state.isAdmin ? BartesianDB.listPeople() : [];
    return shell(isCocktail ? "list" : "rimmers", `
      <section class="panel">
        <a class="back" href="${backHref}" data-go="${backHref}">← Back to ${esc(item.name)}</a>
        <div class="detail-hero history-head">
          <div class="thumb large ${img ? "" : "thumb-empty"}">${img ? `<img src="${esc(img)}" alt="">` : ""}</div>
          <div>
            <p class="detail-kicker">${isCocktail ? "Cocktail" : "Rimmer"} history</p>
            <h1 class="detail-title">${esc(item.name)}</h1>
            <p class="count">${rows.length} event${rows.length === 1 ? "" : "s"}</p>
            ${state.isAdmin ? `<p class="hint">Admin: Edit changes timestamp${rows.some((r) => r.kind === "use" || r.kind === "restock") ? " / who used it" : ""}; Delete removes a record permanently (quantities unchanged).</p>` : ""}
          </div>
        </div>
        <div class="list">${activityRowsHtml(rows, "No history for this item yet.")}</div>
      </section>
      ${historyModalHtml(people)}`);
  }

  function bartesianArrow(url) {
    if (!url) return "";
    return `<a class="icon-link" href="${esc(url)}" target="_blank" rel="noopener" aria-label="View on Bartesian" title="View on Bartesian">↗</a>`;
  }

  function renderWishlist() {
    const items = BartesianDB.listWishlist();
    const rows = items.length
      ? items.map((w) => {
          const detailHref = w.type === "cocktail" ? "#/cocktail/" + w.cocktail_id : "#/rimmer/" + w.rimmer_id;
          return `
          <div class="action-row">
            <span class="qty-badge ${w.type === "rimmer" ? rimmerQtyBadgeClass(Number(w.quantity) || 0, false) : qtyBadgeClass(Number(w.quantity) || 0, false)}" aria-label="On hand ${w.quantity}">${w.quantity}</span>
            <div class="thumb ${w.image ? "" : "thumb-empty"}">${w.image ? `<img src="${esc(w.image)}" alt="">` : ""}</div>
            <div class="row-body">
              <div class="row-title"><a href="${detailHref}" data-go="${detailHref}">${esc(w.name)}</a></div>
              <div class="row-meta">${w.type === "cocktail" ? "Cocktail" : "Rimmer"} · on hand ${w.quantity}</div>
              <div class="wish-qty">
                <span class="muted">Want</span>
                <button type="button" class="ghost small" data-wishlist-qty="-1" data-id="${w.id}">−</button>
                <strong>${w.qty_wanted}</strong>
                <button type="button" class="ghost small" data-wishlist-qty="1" data-id="${w.id}">+</button>
              </div>
            </div>
            <div class="row-actions">
              ${bartesianArrow(w.bartesian_url)}
              <button type="button" class="ghost danger" data-wishlist-remove="${w.id}">Remove</button>
            </div>
          </div>`;
        }).join("")
      : `<p class="empty">Wishlist is empty. Add items from a cocktail/rimmer detail page or the Restock screen.</p>`;
    return shell("wishlist", `
      <section class="panel">
        <p class="section-label">Shopping</p>
        <h1>Wishlist</h1>
        <p class="count">${items.length} item${items.length === 1 ? "" : "s"}</p>
        <div class="list">${rows}</div>
      </section>`);
  }

  function renderRestock() {
    const items = BartesianDB.listRestock();
    const rows = items.length
      ? items.map((it) => {
          const isC = it.type === "cocktail";
          const detailHref = isC ? "#/cocktail/" + it.id : "#/rimmer/" + it.id;
          const img = isC ? primaryImage(it) : it.image || "";
          return `
          <div class="action-row">
            <span class="qty-badge is-restock" aria-label="Quantity 0, restock needed">0</span>
            <div class="thumb ${img ? "" : "thumb-empty"}">${img ? `<img src="${esc(img)}" alt="">` : ""}</div>
            <div class="row-body">
              <div class="row-title"><a href="${detailHref}" data-go="${detailHref}">${esc(it.name)}</a></div>
              <div class="row-meta">${isC ? "Cocktail" : "Rimmer"} · out of stock</div>
            </div>
            <div class="row-actions">
              ${bartesianArrow(it.bartesian_url)}
              <button type="button" class="ghost" data-restock-wishlist="${it.type}:${it.id}">Add to Wishlist</button>
              <button type="button" class="ghost danger" data-restock-clear="${it.type}:${it.id}">Remove</button>
            </div>
          </div>`;
        }).join("")
      : `<p class="empty">Nothing to restock. Items appear here when their last capsule/rimmer is used (1 → 0).</p>`;
    return shell("restock", `
      <section class="panel">
        <p class="section-label">Inventory</p>
        <h1>Restock</h1>
        <p class="lede">Items that ran out (1 → 0). Restocking clears them; Remove only clears the flag.</p>
        <p class="count">${items.length} item${items.length === 1 ? "" : "s"}</p>
        <div class="list">${rows}</div>
      </section>`);
  }

  function decodedMetaHtml(decoded) {
    if (!decoded) return "";
    return `<div class="scan-decoded muted">
      <p>Decoded capsule · Drink ID <strong>${esc(decoded.drinkId)}</strong>
        · ${esc(decoded.glass)}
        ${decoded.spirits && decoded.spirits.length ? " · " + esc(decoded.spirits.join(", ")) : ""}
        ${decoded.romkalName ? " · map: " + esc(decoded.romkalName) : ""}
      </p>
      <p class="hint">Format: <a href="https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md" target="_blank" rel="noopener">romkal/bartesian_barcode</a></p>
    </div>`;
  }

  function scanPreviewHtml(preview) {
    if (!preview) return "";
    if (!preview.ok) {
      return `
        <div class="scan-card">
          <p class="error">${esc(preview.error)}</p>
          ${decodedMetaHtml(preview.decoded)}
          ${
            preview.formatLabel
              ? `<p class="hint">Detected format: ${esc(preview.formatLabel)}${
                  preview.suggestedKind
                    ? " → Kind will default to " + esc(BartesianBarcodes.kindLabel(preview.suggestedKind))
                    : ""
                }</p>`
              : ""
          }
          ${
            preview.unknown
              ? `<p><a href="#/admin/barcodes" data-go="#/admin/barcodes" data-admin-prefill="${esc(preview.code)}" data-admin-prefill-kind="${esc(preview.suggestedKind || "")}">Associate this code →</a></p>`
              : ""
          }
        </div>`;
    }

    const rows = (preview.proposed || [])
      .map(
        (p) => `
        <li class="scan-line">
          <div class="thumb ${p.image ? "" : "thumb-empty"}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}</div>
          <div>
            <strong>${esc(p.name)}</strong>
            <span class="muted"> ${p.delta >= 0 ? "+" : ""}${p.delta} → ${p.next}</span>
          </div>
        </li>`
      )
      .join("");

    const adjust =
      preview.adjustable
        ? `<div class="scan-delta" role="group" aria-label="Quantity change">
            <button type="button" class="ghost ${state.scanDelta < 0 ? "on" : ""}" data-scan-delta="-1">Use (−1)</button>
            <button type="button" class="ghost ${state.scanDelta > 0 ? "on" : ""}" data-scan-delta="1">Restock (+1)</button>
          </div>`
        : `<p class="muted">Restock from case / pack (confirm to apply).</p>`;

    return `
      <div class="scan-card" data-scan-preview>
        <p class="ok"><strong>${esc(preview.kindLabel)}</strong> · ${esc(preview.targetName)}
          ${preview.source === "romkal" ? '<span class="pill">auto-matched</span>' : ""}
        </p>
        ${decodedMetaHtml(preview.decoded)}
        ${adjust}
        <ul class="scan-lines">${rows}</ul>
        <div class="scan-actions">
          <button type="button" data-scan-confirm>Confirm</button>
          <button type="button" class="ghost" data-scan-cancel>Cancel</button>
        </div>
      </div>`;
  }

  function cameraPanelHtml(target) {
    // iPadOS/iOS: <input type="file" accept="image/*"> opens the system sheet
    // (Take Photo / Photo Library / Browse). capture=environment jumps to camera.
    const pickers = `
      <div class="camera-actions">
        <label class="btn-file">
          Take photo or choose image
          <input type="file" accept="image/*" data-image-pick="${esc(target)}" />
        </label>
        <label class="btn-file ghost">
          Take photo
          <input type="file" accept="image/*" capture="environment" data-image-pick="${esc(target)}" />
        </label>
        <button type="button" class="ghost" data-camera-start="${esc(target)}">Live scan</button>
      </div>
      <p class="hint">On iPad, “Take photo or choose image” uses the system prompt for Camera, Photos, or Files. Live scan needs camera permission in Safari/PWA.</p>`;

    if (!state.cameraOn || cameraTarget !== target) {
      return pickers;
    }
    return `
      ${pickers}
      <div class="camera-panel">
        <div class="camera-viewport">
          <video data-camera-video playsinline muted autoplay></video>
          <div class="camera-guide" aria-hidden="true"></div>
        </div>
        <canvas data-camera-canvas class="camera-canvas" hidden></canvas>
        <p class="hint" data-camera-status>${esc(state.cameraStatus || "Scanning…")}</p>
        <p class="hint">Hold the capsule lid barcode in the middle band. Bartesian uses a non-standard Code&nbsp;128 — see <a href="https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md" target="_blank" rel="noopener">romkal/BARCODES.md</a>.</p>
        <button type="button" class="ghost" data-camera-stop>Close live scan</button>
      </div>`;
  }

  function renderScan() {
    const previewHtml = scanPreviewHtml(state.scanPreview);
    return shell(
      "scan",
      `
      <section class="panel">
        <p class="section-label">Inventory</p>
        <h1>Scan barcode</h1>
        <p class="lede">Use the camera, a USB wedge scanner, or type a code. Nothing changes until you confirm.</p>
        <ul class="plain muted">
          <li>Capsule / rimmer → default <strong>−1</strong> (flip to +1 before confirm)</li>
          <li>Case → +case qty for that cocktail</li>
          <li>Variety pack → + each included cocktail</li>
        </ul>
        ${cameraPanelHtml("scan")}
        <form class="scan-form" data-scan-lookup>
          <input name="code" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode" required ${state.cameraOn ? "" : "autofocus"} />
          <button type="submit">Look up</button>
        </form>
        <p class="hint">USB scanners type into the field (Enter = look up). Capsule lids use the Bartesian decoder; case/pack labels use a built-in UPC/EAN decoder (works on iPad).</p>
        <div data-scan-result>${previewHtml}</div>
      </section>
    `
    );
  }

  function renderAdminBarcodes() {
    const cocktails = BartesianDB.listAllCocktails();
    const packs = BartesianDB.listPacks();
    const rimmers = BartesianDB.listRimmers({});
    const barcodes = BartesianDB.listBarcodes();
    const decoded = state.adminCode ? BartesianBarcodes.decodeCapsule(state.adminCode) : null;

    let selectedCocktailId = state.adminCocktailId;
    if (!selectedCocktailId && decoded && decoded.slug) {
      const hit = cocktails.find((c) => c.slug === decoded.slug);
      if (hit) selectedCocktailId = String(hit.id);
    }

    const cocktailOpts = cocktails
      .map(
        (c) =>
          `<option value="${c.id}" ${String(c.id) === String(selectedCocktailId) ? "selected" : ""}>${esc(c.name)}${c.enabled ? "" : " (disabled)"}</option>`
      )
      .join("");
    const packOpts = packs.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    const rimmerOpts = rimmers.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");

    const table = barcodes.length
      ? `<table class="data-table">
          <thead><tr><th>Code</th><th>Kind</th><th>Target</th><th></th></tr></thead>
          <tbody>
            ${barcodes
              .map((b) => {
                const target =
                  b.cocktail_name || b.pack_name || b.rimmer_name || "—";
                return `<tr>
                  <td><code>${esc(b.code)}</code></td>
                  <td>${esc(BartesianBarcodes.kindLabel(b.kind))}</td>
                  <td>${esc(target)}</td>
                  <td><button type="button" class="ghost danger" data-barcode-delete="${esc(b.code)}">Remove</button></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`
      : `<p class="muted">No local barcode associations yet. Use Look up + Save, or confirm a Scan (romkal match auto-saves).</p>`;

    return shell(
      "admin-barcodes",
      `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Barcode associations</h1>
        <p class="lede">Enter or camera-scan a barcode, <strong>Look up</strong> (romkal capsule decode), then set Kind / Cocktail (or pack / rimmer) and <strong>Save</strong>. Export writes <code>Capsule Barcode:</code> into cocktail <code>.txt</code> files for git.</p>
        ${cameraPanelHtml("admin")}

        <form class="admin-barcode-form" data-admin-barcode>
          <label>Barcode
            <div class="admin-code-row">
              <input name="code" type="text" inputmode="numeric" autocomplete="off" required value="${esc(state.adminCode)}" data-admin-code />
              <button type="button" class="ghost" data-admin-lookup>Look up</button>
            </div>
          </label>
          ${
            state.adminLookupNote
              ? `<p class="ok">${esc(state.adminLookupNote)}</p>`
              : ""
          }
          ${decodedMetaHtml(decoded)}
          <label>Kind
            <select name="kind" data-admin-kind>
              <option value="capsule" ${state.adminKind === "capsule" ? "selected" : ""}>Capsule</option>
              <option value="case" ${state.adminKind === "case" ? "selected" : ""}>Case (single flavor)</option>
              <option value="variety_pack" ${state.adminKind === "variety_pack" ? "selected" : ""}>Variety pack</option>
              <option value="rimmer" ${state.adminKind === "rimmer" ? "selected" : ""}>Rimmer</option>
            </select>
          </label>
          <label class="${state.adminKind === "variety_pack" || state.adminKind === "rimmer" ? "is-hidden" : ""}" data-admin-cocktail-wrap>Cocktail
            <select name="cocktail_id" data-admin-cocktail>${cocktailOpts}</select>
          </label>
          <label class="${state.adminKind === "variety_pack" ? "" : "is-hidden"}" data-admin-pack-wrap>Pack
            <select name="pack_id">${packOpts}</select>
          </label>
          <label class="${state.adminKind === "rimmer" ? "" : "is-hidden"}" data-admin-rimmer-wrap>Rimmer
            <select name="rimmer_id">${rimmerOpts}</select>
          </label>
          <label class="${state.adminKind === "case" ? "" : "is-hidden"}" data-admin-qty-wrap>Case qty
            <input name="case_qty" type="number" min="1" max="48" value="8" />
          </label>
          <button type="submit">Save association</button>
        </form>
        <h2>Saved mappings</h2>
        ${table}
      </section>
    `
    );
  }

  function renderRandom() {
    const spirits = BartesianDB.listSpirits();
    return shell(
      "random",
      `
      <section class="panel">
        <p class="section-label">Surprise</p>
        <h1>Randomizer</h1>
        <p class="lede">Pick an in-stock cocktail. Optionally narrow by spirit or favorites.</p>
        <form class="toolbar" data-random-form>
          <select name="spirit">
            <option value="">Any spirit</option>
            ${spirits
              .map(
                (s) =>
                  `<option value="${esc(s.name)}" ${state.randomSpirit === s.name ? "selected" : ""}>${esc(s.name)}</option>`
              )
              .join("")}
          </select>
          <label class="check"><input type="checkbox" name="favorites" ${state.randomFavoritesOnly ? "checked" : ""}/> Favorites only</label>
          <button type="submit">Surprise me</button>
        </form>
        <div data-random-result></div>
      </section>
    `
    );
  }

  function adminToggleBtn(attrs, on, labelOn, labelOff) {
    return `<button type="button" class="ghost small" ${attrs} data-on="${on ? 1 : 0}">${on ? labelOn : labelOff}</button>`;
  }

  function renderAdminCocktails() {
    const cocktails = BartesianDB.listAllCocktails();
    const rows = cocktails.map((c) => `
      <div class="action-row admin-row">
        <span class="qty-badge ${qtyBadgeClass(Number(c.quantity) || 0, c.restock)}">${c.quantity}</span>
        <div class="thumb ${primaryImage(c) ? "" : "thumb-empty"}">${primaryImage(c) ? `<img src="${esc(primaryImage(c))}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title"><a class="row-body-link" href="#/cocktail/${c.id}" data-go="#/cocktail/${c.id}">${esc(c.name)}${c.enabled ? "" : ' <span class="pill">Disabled</span>'}</a></div>
          <div class="row-meta">${esc((c.spirits_csv || "").split("|").filter(Boolean).join(", ") || "—")}</div>
          <div class="row-actions admin-actions">
            <button type="button" class="ghost small" data-qty-delta="-1" data-id="${c.id}">−</button>
            <button type="button" class="ghost small" data-qty-delta="1" data-id="${c.id}">+</button>
            ${adminToggleBtn(`data-admin-cocktail-fav data-id="${c.id}"`, c.favorite, "Favorited ★", "Favorite")}
            ${adminToggleBtn(`data-admin-cocktail-seasonal data-id="${c.id}"`, c.seasonal, "Seasonal ✓", "Seasonal")}
            ${adminToggleBtn(`data-admin-cocktail-enabled data-id="${c.id}"`, c.enabled, "Enabled ✓", "Disabled")}
          </div>
        </div>
      </div>`).join("");
    return shell("admin-cocktails", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Cocktails</h1>
        <p class="lede">Quick toggles for every cocktail (including disabled). Open a name for the full detail page.</p>
        <p class="count">${cocktails.length} cocktails</p>
        <div class="list">${rows || `<p class="empty">None.</p>`}</div>
      </section>`);
  }

  function renderAdminRimmers() {
    const rimmers = BartesianDB.listAllRimmersAdmin();
    const rows = rimmers.map((r) => `
      <div class="action-row admin-row">
        <span class="qty-badge ${rimmerQtyBadgeClass(Number(r.quantity) || 0, r.restock)}">${r.quantity}</span>
        <div class="thumb ${r.image ? "" : "thumb-empty"}">${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title"><a class="row-body-link" href="#/rimmer/${r.id}" data-go="#/rimmer/${r.id}">${esc(r.name)}${r.enabled ? "" : ' <span class="pill">Disabled</span>'}</a></div>
          <form class="admin-rimmer-edit" data-admin-rimmer-edit data-id="${r.id}">
            <label>Name
              <input name="name" type="text" value="${esc(r.name)}" required />
            </label>
            <label class="kind-field">Type
              <input name="kind" type="text" list="rimmer-kind-options" placeholder="sugar, salt, candy…" value="${esc(r.kind || "")}" />
            </label>
            <button type="submit" class="ghost small">Save</button>
          </form>
          <div class="row-actions admin-actions">
            <button type="button" class="ghost small" data-rimmer-qty-delta="-1" data-id="${r.id}">−</button>
            <button type="button" class="ghost small" data-rimmer-qty-delta="1" data-id="${r.id}">+</button>
            ${adminToggleBtn(`data-rimmer-toggle-fav data-id="${r.id}"`, r.favorite, "Favorited ★", "Favorite")}
            ${adminToggleBtn(`data-admin-rimmer-enabled data-id="${r.id}"`, r.enabled, "Enabled ✓", "Disabled")}
          </div>
        </div>
      </div>`).join("");
    return shell("admin-rimmers", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Rimmers</h1>
        <p class="lede">Edit name and type (free text — sugar, salt, candy, …), then Save. Export from Settings to write changes back to <code>data/rimmers/*.txt</code>.</p>
        <p class="count">${rimmers.length} rimmers</p>
        <datalist id="rimmer-kind-options">
          <option value="sugar"></option>
          <option value="salt"></option>
        </datalist>
        <div class="list">${rows || `<p class="empty">None.</p>`}</div>
      </section>`);
  }

  function renderAdminPacks() {
    const packs = BartesianDB.listAllPacksAdmin();
    const barcodes = BartesianDB.listBarcodes();
    const rows = packs.map((p) => {
      const items = BartesianDB.getPackItems(p.id);
      const bc = barcodes.find((b) => b.pack_id === p.id);
      return `
      <div class="action-row admin-row">
        <span aria-hidden="true"></span>
        <div class="thumb ${p.image ? "" : "thumb-empty"}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title">${esc(p.name)}${p.enabled ? "" : ' <span class="pill">Disabled</span>'}</div>
          <div class="row-meta">${items.length} item${items.length === 1 ? "" : "s"}${bc ? " · " + esc(bc.code) : ""}</div>
          <div class="row-meta">${esc(items.map((i) => i.name + " ×" + i.qty).join(", ") || "—")}</div>
          <div class="row-actions admin-actions">
            ${adminToggleBtn(`data-admin-pack-enabled data-id="${p.id}"`, p.enabled, "Enabled ✓", "Disabled")}
          </div>
        </div>
      </div>`;
    }).join("");
    return shell("admin-packs", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Packs</h1>
        <p class="count">${packs.length} packs</p>
        <div class="list">${rows || `<p class="empty">None.</p>`}</div>
      </section>`);
  }

  function renderPeople() {
    const people = BartesianDB.listPeople();
    return shell(
      "admin-people",
      `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>People</h1>
        <p class="lede">Raters for cocktail comments. Admins see the Admin menu (saved in the <code>${esc(ADMIN_COOKIE)}</code> cookie for ${esc(CURRENT_USER)}).</p>
        <div class="list">
          ${people.map((p) => `
            <div class="action-row admin-row">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <div class="row-body">
                <div class="row-title">${esc(p.name)}${p.is_admin ? ' <span class="pill">Admin</span>' : ""}</div>
              </div>
              <div class="row-actions">
                ${adminToggleBtn(`data-person-admin data-id="${p.id}" data-name="${esc(p.name)}"`, p.is_admin, "Admin ✓", "Make admin")}
              </div>
            </div>`).join("") || `<p class="empty">None yet.</p>`}
        </div>
        <form class="inline-form" data-add-person>
          <input name="name" type="text" placeholder="Name" required />
          <button type="submit">Add person</button>
        </form>
      </section>
    `
    );
  }

  function renderSettings() {
    return shell(
      "settings",
      `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Settings</h1>
        <h2>Export for GitHub</h2>
        <p>Downloads <code>bartesian-exports.zip</code>. Copy it to <code>exports/bartesian-exports.zip</code>, then run <code>node scripts/import-data.js</code> (or the Import debug task). That updates <code>data/</code> + seed; on next load the app applies seed quantities into local IndexedDB. Commit when ready.</p>
        <p class="hint">A normal reload keeps your browser DB. After an import, Force refresh (or hard reload) so the new seed rev is picked up — inventory counts then sync from seed.</p>
        <button type="button" data-export>Export data</button>
        <p class="hint" data-export-status></p>
        <h2>Barcodes</h2>
        <p><a href="#/admin/barcodes" data-go="#/admin/barcodes">Associate scanned codes</a> with cocktails, cases, packs, or rimmers. Capsule lid numbers auto-match when present in the romkal drink map.</p>
        <h2>Force refresh</h2>
        <p>For iPad / PWA: unregister the service worker, clear caches, and reload. Keeps your local inventory database.</p>
        <p class="muted">Current build: <code>${esc(APP_VERSION)}</code></p>
        <button type="button" data-force-refresh>Force refresh</button>
        <h2>Local database</h2>
        <p>Clear IndexedDB and re-seed from <code>js/seed-data.js</code>. History, Wishlist, ratings, and Restock flags are only restored if they were exported and re-imported first.</p>
        <button type="button" class="danger" data-reset>Reset local DB</button>
      </section>
    `
    );
  }

  async function forceRefreshApp() {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
    } catch (_) {
      /* continue */
    }
    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (_) {
      /* continue */
    }
    try {
      localStorage.removeItem("bartesian-sw-migrated");
    } catch (_) {
      /* continue */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("_refresh", String(Date.now()));
    window.location.replace(url.toString());
  }

  function renderDisclaimer() {
    return shell(
      "list",
      `
      <section class="panel">
        <p class="section-label">Legal</p>
        <h1>Disclaimer</h1>
        <p>This site is a <strong>private</strong> household inventory and cocktail reference. It is not a public product or service.</p>
        <p>It is <strong>not affiliated with, endorsed by, or connected to Bartesian</strong> (or any related company).</p>
        <p>See <code>DISCLAIMER.md</code> in the repository for the full notice.</p>
      </section>
    `
    );
  }

  function routeKeyFor(route) {
    return [route.view, route.itemType || "", route.id || ""].join(":");
  }

  function render() {
    const route = parseHash();
    const nextRouteKey = routeKeyFor(route);
    const isFirstRender = currentRouteKey === "";
    const isRouteChange = !isFirstRender && currentRouteKey !== nextRouteKey;
    if (isRouteChange) {
      // Remember where we left this screen so Back restores it (e.g. list scroll).
      routeScrollPositions.set(currentRouteKey, window.scrollY);
    }
    currentRouteKey = nextRouteKey;
    // Stop camera when leaving scan/admin
    if (
      state.cameraOn &&
      route.view !== "scan" &&
      route.view !== "admin-barcodes"
    ) {
      stopCamera();
    }
    if (route.view !== "item-history") state.historyModal = null;
    if (ADMIN_VIEWS.includes(route.view) && !state.isAdmin) {
      root.innerHTML = shell("list", `
        <section class="panel">
          <p class="section-label">Admin</p>
          <h1>Admin only</h1>
          <p class="lede">This area is for ${esc(CURRENT_USER)} (admin). The Admin menu appears when the admin cookie is set.</p>
          <p><a href="#/" data-go="#/">← Back to Cocktails</a></p>
        </section>`);
      state.flash = "";
      if (isFirstRender || isRouteChange) window.scrollTo(0, 0);
      return;
    }
    if (route.view === "detail") root.innerHTML = renderDetail(route.id);
    else if (route.view === "rimmers") root.innerHTML = renderRimmers();
    else if (route.view === "rimmer-detail") root.innerHTML = renderRimmerDetail(route.id);
    else if (route.view === "scan") root.innerHTML = renderScan();
    else if (route.view === "item-history") root.innerHTML = renderItemHistory(route.itemType, route.id);
    else if (route.view === "wishlist") root.innerHTML = renderWishlist();
    else if (route.view === "restock") root.innerHTML = renderRestock();
    else if (route.view === "admin-barcodes") root.innerHTML = renderAdminBarcodes();
    else if (route.view === "admin-cocktails") root.innerHTML = renderAdminCocktails();
    else if (route.view === "admin-rimmers") root.innerHTML = renderAdminRimmers();
    else if (route.view === "admin-packs") root.innerHTML = renderAdminPacks();
    else if (route.view === "admin-people" || route.view === "people") root.innerHTML = renderPeople();
    else if (route.view === "random") root.innerHTML = renderRandom();
    else if (route.view === "settings") root.innerHTML = renderSettings();
    else if (route.view === "disclaimer") root.innerHTML = renderDisclaimer();
    else root.innerHTML = renderList();
    state.flash = "";
    if (isFirstRender || isRouteChange) {
      // New screens always start at the top; returning to a screen restores
      // its previous scroll spot (so Back to the list keeps your place).
      const saved = routeScrollPositions.get(nextRouteKey);
      window.scrollTo(0, saved != null ? saved : 0);
    }
    scheduleAlphaIndexSync();
  }

  async function onClick(e) {
    // Quantity badge steppers (list screens) — before [data-go] row navigation
    const qtyStep = e.target.closest("[data-qty-step]");
    if (qtyStep) {
      e.preventDefault();
      const id = Number(qtyStep.getAttribute("data-id"));
      const delta = Number(qtyStep.getAttribute("data-delta"));
      if (qtyStep.getAttribute("data-qty-type") === "rimmer") {
        await BartesianDB.adjustRimmerQuantity(id, delta, delta > 0 ? "manual_add" : "manual_remove");
      } else {
        await BartesianDB.adjustQuantity(id, delta, delta > 0 ? "manual_add" : "manual_remove");
      }
      // Stay expanded (controls adapt: 0 → + only, ≥1 → −/+)
      render();
      return;
    }

    const qtyOpen = e.target.closest("[data-qty-open]");
    if (qtyOpen) {
      e.preventDefault();
      state.qtyOpenKey = qtyOpen.getAttribute("data-qty-open") || "";
      render();
      return;
    }

    if (e.target.closest("[data-qty-controls]")) {
      // Tapping the open badge itself: stay expanded, don't navigate the row
      e.preventDefault();
      return;
    }

    if (state.qtyOpenKey) {
      // Clicking elsewhere collapses the badge; interactive targets continue below
      state.qtyOpenKey = "";
      if (!e.target.closest("a, button, input, select, textarea, label")) {
        render();
        return;
      }
    }

    // History admin modals
    if (e.target.closest("[data-history-modal-close]")) {
      state.historyModal = null;
      render();
      return;
    }
    if (
      state.historyModal &&
      e.target.hasAttribute &&
      e.target.hasAttribute("data-history-modal-backdrop")
    ) {
      state.historyModal = null;
      render();
      return;
    }
    const historyEdit = e.target.closest("[data-history-edit]");
    if (historyEdit) {
      const entry = BartesianDB.getActivity(Number(historyEdit.getAttribute("data-history-edit")));
      if (!entry) return;
      state.historyModal = {
        mode: "edit",
        id: entry.id,
        kind: entry.kind,
        label: activityLabel(entry),
        createdLocal: toLocalInputValue(entry.created_at),
        personName: entry.person_name || "",
      };
      render();
      return;
    }
    const historyDelete = e.target.closest("[data-history-delete]");
    if (historyDelete) {
      const entry = BartesianDB.getActivity(Number(historyDelete.getAttribute("data-history-delete")));
      if (!entry) return;
      state.historyModal = {
        mode: "delete",
        id: entry.id,
        label: activityLabel(entry),
        when: formatWhen(entry.created_at),
      };
      render();
      return;
    }
    const historyDeleteConfirm = e.target.closest("[data-history-delete-confirm]");
    if (historyDeleteConfirm) {
      await BartesianDB.deleteActivity(
        Number(historyDeleteConfirm.getAttribute("data-history-delete-confirm"))
      );
      state.historyModal = null;
      state.flash = "History record deleted.";
      render();
      return;
    }

    const jump = e.target.closest('[data-act="jump-index"]');
    if (jump) {
      e.preventDefault();
      const letter = jump.getAttribute("data-letter");
      if (letter) jumpToIndexLetter(letter);
      return;
    }

    const goEl = e.target.closest("[data-go]");
    if (goEl) {
      e.preventDefault();
      go(goEl.getAttribute("data-go"));
      return;
    }

    const wishC = e.target.closest("[data-wishlist-add-cocktail]");
    if (wishC) {
      await BartesianDB.addToWishlist({ cocktailId: Number(wishC.getAttribute("data-wishlist-add-cocktail")) });
      state.flash = "Added to Wishlist.";
      render();
      return;
    }
    const wishR = e.target.closest("[data-wishlist-add-rimmer]");
    if (wishR) {
      await BartesianDB.addToWishlist({ rimmerId: Number(wishR.getAttribute("data-wishlist-add-rimmer")) });
      state.flash = "Added to Wishlist.";
      render();
      return;
    }
    const wishQty = e.target.closest("[data-wishlist-qty]");
    if (wishQty) {
      await BartesianDB.adjustWishlistQty(
        Number(wishQty.getAttribute("data-id")),
        Number(wishQty.getAttribute("data-wishlist-qty"))
      );
      render();
      return;
    }
    const wishRemove = e.target.closest("[data-wishlist-remove]");
    if (wishRemove) {
      await BartesianDB.removeFromWishlist(Number(wishRemove.getAttribute("data-wishlist-remove")));
      render();
      return;
    }
    const restockWish = e.target.closest("[data-restock-wishlist]");
    if (restockWish) {
      const [type, idStr] = String(restockWish.getAttribute("data-restock-wishlist")).split(":");
      if (type === "cocktail") await BartesianDB.addToWishlist({ cocktailId: Number(idStr) });
      else await BartesianDB.addToWishlist({ rimmerId: Number(idStr) });
      state.flash = "Added to Wishlist.";
      render();
      return;
    }
    const restockClear = e.target.closest("[data-restock-clear]");
    if (restockClear) {
      const [type, idStr] = String(restockClear.getAttribute("data-restock-clear")).split(":");
      if (type === "cocktail") await BartesianDB.clearRestock({ cocktailId: Number(idStr) });
      else await BartesianDB.clearRestock({ rimmerId: Number(idStr) });
      render();
      return;
    }

    const deltaBtn = e.target.closest("[data-qty-delta]");
    if (deltaBtn) {
      const id = Number(deltaBtn.getAttribute("data-id"));
      const delta = Number(deltaBtn.getAttribute("data-qty-delta"));
      await BartesianDB.adjustQuantity(id, delta, delta > 0 ? "manual_add" : "manual_remove");
      render();
      return;
    }

    const rimmerDeltaBtn = e.target.closest("[data-rimmer-qty-delta]");
    if (rimmerDeltaBtn) {
      const id = Number(rimmerDeltaBtn.getAttribute("data-id"));
      const delta = Number(rimmerDeltaBtn.getAttribute("data-rimmer-qty-delta"));
      await BartesianDB.adjustRimmerQuantity(
        id,
        delta,
        delta > 0 ? "manual_add" : "manual_remove"
      );
      render();
      return;
    }

    const useBtn = e.target.closest("[data-use-one]");
    if (useBtn) {
      const id = Number(useBtn.getAttribute("data-id"));
      await BartesianDB.adjustQuantity(id, -1, "use_capsule");
      render();
      return;
    }

    const favBtn = e.target.closest("[data-toggle-fav]");
    if (favBtn) {
      const id = Number(favBtn.getAttribute("data-id"));
      const on = favBtn.getAttribute("data-on") === "1";
      await BartesianDB.setFavorite(id, !on);
      render();
      return;
    }

    const rimmerFavBtn = e.target.closest("[data-rimmer-toggle-fav]");
    if (rimmerFavBtn) {
      const id = Number(rimmerFavBtn.getAttribute("data-id"));
      const on = rimmerFavBtn.getAttribute("data-on") === "1";
      await BartesianDB.setRimmerFavorite(id, !on);
      render();
      return;
    }

    const personAdminBtn = e.target.closest("[data-person-admin]");
    if (personAdminBtn) {
      const id = Number(personAdminBtn.getAttribute("data-id"));
      const name = personAdminBtn.getAttribute("data-name") || "";
      const on = personAdminBtn.getAttribute("data-on") === "1";
      if (on && name.toLowerCase() === CURRENT_USER.toLowerCase()) {
        if (!confirm("Remove your own admin flag? The Admin menu will disappear (cookie cleared). You can restore it by Reset local DB.")) return;
      }
      await BartesianDB.setPersonAdmin(id, !on);
      syncAdminFromDb();
      // If Lawrence was just granted/revoked sync already handled; for other people keep cookie
      render();
      return;
    }

    const adminCocktailFav = e.target.closest("[data-admin-cocktail-fav]");
    if (adminCocktailFav) {
      await BartesianDB.setFavorite(Number(adminCocktailFav.getAttribute("data-id")), adminCocktailFav.getAttribute("data-on") !== "1");
      render(); return;
    }
    const adminCocktailSeasonal = e.target.closest("[data-admin-cocktail-seasonal]");
    if (adminCocktailSeasonal) {
      await BartesianDB.setCocktailSeasonal(Number(adminCocktailSeasonal.getAttribute("data-id")), adminCocktailSeasonal.getAttribute("data-on") !== "1");
      render(); return;
    }
    const adminCocktailEnabled = e.target.closest("[data-admin-cocktail-enabled]");
    if (adminCocktailEnabled) {
      await BartesianDB.setCocktailEnabled(Number(adminCocktailEnabled.getAttribute("data-id")), adminCocktailEnabled.getAttribute("data-on") !== "1");
      render(); return;
    }
    const adminRimmerEnabled = e.target.closest("[data-admin-rimmer-enabled]");
    if (adminRimmerEnabled) {
      await BartesianDB.setRimmerEnabled(Number(adminRimmerEnabled.getAttribute("data-id")), adminRimmerEnabled.getAttribute("data-on") !== "1");
      render(); return;
    }
    const adminPackEnabled = e.target.closest("[data-admin-pack-enabled]");
    if (adminPackEnabled) {
      await BartesianDB.setPackEnabled(Number(adminPackEnabled.getAttribute("data-id")), adminPackEnabled.getAttribute("data-on") !== "1");
      render(); return;
    }

    const scanDeltaBtn = e.target.closest("[data-scan-delta]");
    if (scanDeltaBtn) {
      state.scanDelta = Number(scanDeltaBtn.getAttribute("data-scan-delta"));
      if (state.scanPreview && state.scanPreview.code) {
        state.scanPreview = BartesianBarcodes.resolve(BartesianDB, state.scanPreview.code, {
          capsuleDelta: state.scanDelta,
          rimmerDelta: state.scanDelta,
        });
      }
      const box = root.querySelector("[data-scan-result]");
      if (box) box.innerHTML = scanPreviewHtml(state.scanPreview);
      return;
    }

    if (e.target.closest("[data-scan-cancel]")) {
      state.scanPreview = null;
      state.scanDelta = -1;
      const box = root.querySelector("[data-scan-result]");
      if (box) box.innerHTML = "";
      const input = root.querySelector("[data-scan-lookup] input[name=code]");
      if (input) {
        input.value = "";
        input.focus();
      }
      return;
    }

    if (e.target.closest("[data-scan-confirm]")) {
      if (!state.scanPreview || !state.scanPreview.ok) return;
      const result = await BartesianDB.applyResolved(state.scanPreview);
      const box = root.querySelector("[data-scan-result]");
      if (!box) return;
      if (!result.ok) {
        box.innerHTML = `<p class="error">${esc(result.error)}</p>`;
        return;
      }
      box.innerHTML = `
        <p class="ok">Applied <strong>${esc(BartesianBarcodes.kindLabel(result.kind))}</strong>:</p>
        <ul class="plain">
          ${result.changes
            .map(
              (ch) =>
                `<li>${esc(ch.name)}: ${ch.delta >= 0 ? "+" : ""}${ch.delta} → ${ch.quantity}</li>`
            )
            .join("")}
        </ul>`;
      state.scanPreview = null;
      state.scanDelta = -1;
      const form = root.querySelector("[data-scan-lookup]");
      if (form) form.reset();
      const input = root.querySelector("[data-scan-lookup] input[name=code]");
      if (input) input.focus();
      return;
    }

    const delBc = e.target.closest("[data-barcode-delete]");
    if (delBc) {
      const code = delBc.getAttribute("data-barcode-delete");
      if (!confirm("Remove barcode " + code + "?")) return;
      await BartesianDB.deleteBarcode(code);
      render();
      return;
    }

    const prefill = e.target.closest("[data-admin-prefill]");
    if (prefill) {
      const code = prefill.getAttribute("data-admin-prefill") || "";
      const kindHint = prefill.getAttribute("data-admin-prefill-kind") || "";
      applyAdminLookup(code);
      if (kindHint && !BartesianDB.findBarcode(BartesianBarcodes.normalizeCode(code))) {
        state.adminKind = kindHint;
      }
    }

    const camStart = e.target.closest("[data-camera-start]");
    if (camStart) {
      e.preventDefault();
      await startCamera(camStart.getAttribute("data-camera-start") || "scan");
      return;
    }
    if (e.target.closest("[data-camera-stop]")) {
      e.preventDefault();
      stopCamera();
      render();
      return;
    }

    if (e.target.closest("[data-force-refresh]")) {
      if (
        !confirm(
          "Force refresh? This clears the service worker cache and reloads. Local inventory is kept."
        )
      ) {
        return;
      }
      await forceRefreshApp();
      return;
    }

    if (e.target.closest("[data-admin-lookup]")) {
      const input = root.querySelector("[data-admin-code]");
      applyAdminLookup(input ? input.value : state.adminCode);
      render();
      return;
    }

    if (e.target.closest("[data-export]")) {
      const status = root.querySelector("[data-export-status]");
      try {
        const result = await BartesianExport.exportAll(BartesianDB.exportSnapshot());
        if (status) {
          status.textContent =
            result.mode === "directory"
              ? "Exported via folder picker."
              : "Downloaded bartesian-exports.zip (folder picker unavailable).";
        }
      } catch (err) {
        if (status) status.textContent = "Export failed: " + err.message;
      }
      return;
    }

    if (e.target.closest("[data-reset]")) {
      if (!confirm("Reset local database from seed data?")) return;
      await BartesianDB.resetLocal();
      state.flash = "Local database reset from seed.";
      go("#/");
      return;
    }
  }

  async function onSubmit(e) {
    const listForm = e.target.closest("[data-list-filters]");
    if (listForm) {
      e.preventDefault();
      const fd = new FormData(listForm);
      state.search = String(fd.get("search") || "");
      state.spirit = String(fd.get("spirit") || "");
      state.sort = String(fd.get("sort") || "name");
      state.availableOnly = listForm.available.checked;
      state.favoritesOnly = listForm.favorites.checked;
      saveListPrefs();
      render();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm) {
      e.preventDefault();
      const fd = new FormData(rimmerForm);
      state.rimmerSearch = String(fd.get("search") || "");
      state.rimmerKind = String(fd.get("kind") || "");
      state.rimmerFavoritesOnly = rimmerForm.favorites ? rimmerForm.favorites.checked : false;
      state.rimmerAvailableOnly = rimmerForm.available ? rimmerForm.available.checked : false;
      render();
      return;
    }

    const rimmerEditForm = e.target.closest("[data-admin-rimmer-edit]");
    if (rimmerEditForm) {
      e.preventDefault();
      const fd = new FormData(rimmerEditForm);
      const updated = await BartesianDB.updateRimmerDetails(
        Number(rimmerEditForm.getAttribute("data-id")),
        {
          name: String(fd.get("name") || ""),
          kind: String(fd.get("kind") || ""),
        }
      );
      state.flash =
        "Saved " +
        (updated ? updated.name : "rimmer") +
        ". Export from Settings to write it back to data/rimmers/*.txt for git.";
      render();
      return;
    }

    const scanLookup = e.target.closest("[data-scan-lookup]");
    if (scanLookup) {
      e.preventDefault();
      const code = new FormData(scanLookup).get("code");
      state.scanDelta = -1;
      state.scanPreview = BartesianBarcodes.resolve(BartesianDB, code, {
        capsuleDelta: state.scanDelta,
        rimmerDelta: state.scanDelta,
      });
      const box = root.querySelector("[data-scan-result]");
      if (box) box.innerHTML = scanPreviewHtml(state.scanPreview);
      return;
    }

    const adminForm = e.target.closest("[data-admin-barcode]");
    if (adminForm) {
      e.preventDefault();
      const fd = new FormData(adminForm);
      const kind = String(fd.get("kind") || "capsule");
      const code = String(fd.get("code") || "").trim();
      try {
        await BartesianDB.upsertBarcode({
          code,
          kind,
          cocktailId:
            kind === "capsule" || kind === "case" ? Number(fd.get("cocktail_id")) : null,
          packId: kind === "variety_pack" ? Number(fd.get("pack_id")) : null,
          rimmerId: kind === "rimmer" ? Number(fd.get("rimmer_id")) : null,
          caseQty: Number(fd.get("case_qty")) || 8,
        });
        state.flash =
          "Saved " +
          code +
          ". Export from Settings to write Capsule/Case Barcode into data/*.txt for git.";
        state.adminCode = "";
        state.adminCocktailId = "";
        state.adminLookupNote = "";
        render();
      } catch (err) {
        state.flash = "Save failed: " + err.message;
        render();
      }
      return;
    }

    const randomForm = e.target.closest("[data-random-form]");
    if (randomForm) {
      e.preventDefault();
      const fd = new FormData(randomForm);
      state.randomSpirit = String(fd.get("spirit") || "");
      state.randomFavoritesOnly = randomForm.favorites.checked;
      const pick = BartesianDB.pickRandom({
        spirit: state.randomSpirit,
        favoritesOnly: state.randomFavoritesOnly,
        availableOnly: true,
      });
      const box = root.querySelector("[data-random-result]");
      if (!box) return;
      if (!pick) {
        box.innerHTML = `<p class="error">No matching in-stock cocktails.</p>`;
        return;
      }
      const pickImg = primaryImage(pick);
      const pickSpirits = (pick.spirits_csv || "").split("|").filter(Boolean).join(", ");
      box.innerHTML = `
        <div class="random-card detail-hero">
          <a class="thumb large ${pickImg ? "" : "thumb-empty"}" href="#/cocktail/${pick.id}" data-go="#/cocktail/${pick.id}" aria-label="${esc(pick.name)}">
            ${pickImg ? `<img src="${esc(pickImg)}" alt="">` : ""}
          </a>
          <div>
            <p class="detail-kicker">Cocktail${pick.seasonal ? " · Seasonal" : ""}</p>
            <h2 class="detail-title random-title">
              <a class="random-title-link" href="#/cocktail/${pick.id}" data-go="#/cocktail/${pick.id}">${esc(pick.name)}${pick.favorite ? " ★" : ""}</a>
            </h2>
            ${pickSpirits ? `<p class="spirits">${esc(pickSpirits)}</p>` : ""}
            <p class="detail-copy">${esc(pick.description || "")}</p>
            <p class="muted">Qty ${pick.quantity} · ${starsLabel(pick.avg_rating)}${pick.glassware ? " · " + esc(pick.glassware) : ""}</p>
          </div>
        </div>
      `;
      return;
    }

    const historyEditForm = e.target.closest("[data-history-edit-form]");
    if (historyEditForm) {
      e.preventDefault();
      const fd = new FormData(historyEditForm);
      const hasPersonField = historyEditForm.querySelector("[name=person_name]") != null;
      await BartesianDB.updateActivity(Number(historyEditForm.getAttribute("data-id")), {
        createdAt: String(fd.get("created_at") || ""),
        personName: hasPersonField ? String(fd.get("person_name") || "") : undefined,
      });
      state.historyModal = null;
      state.flash = "History updated.";
      render();
      return;
    }

    const personForm = e.target.closest("[data-add-person]");
    if (personForm) {
      e.preventDefault();
      const name = new FormData(personForm).get("name");
      await BartesianDB.addPerson(name);
      render();
      return;
    }

    const ratingForm = e.target.closest("[data-rating-form]");
    if (ratingForm) {
      e.preventDefault();
      const fd = new FormData(ratingForm);
      await BartesianDB.upsertRating({
        cocktailId: Number(ratingForm.getAttribute("data-id")),
        personId: Number(fd.get("person_id")),
        stars: Number(fd.get("stars")),
        comment: String(fd.get("comment") || ""),
      });
      render();
    }
  }

  async function onImagePicked(input) {
    const file = input.files && input.files[0];
    const target = input.getAttribute("data-image-pick") || "scan";
    input.value = "";
    if (!file) return;
    state.flash = "Reading image…";
    render();
    try {
      const result = await BartesianCameraScan.decodeImageFile(file);
      if (!result || !result.code) {
        state.flash =
          "No barcode found in that image. Try a sharper close-up of the capsule lid bars, or enter the code manually.";
        render();
        return;
      }
      state.flash = "";
      applyScannedCode(result.code, target);
    } catch (err) {
      state.flash = "Could not read image: " + (err && err.message ? err.message : err);
      render();
    }
  }

  function onInput(e) {
    if (e.target.matches("[data-admin-code]")) {
      state.adminCode = e.target.value;
      return;
    }

    const listForm = e.target.closest("[data-list-filters]");
    if (listForm && e.target.name === "search") {
      state.search = e.target.value;
      saveListPrefs();
      const cocktails = BartesianDB.listCocktails(listQuery());
      const count = root.querySelector(".count");
      if (count) count.textContent = `${cocktails.length} cocktail${cocktails.length === 1 ? "" : "s"}`;
      const shellEl = root.querySelector(".list-shell");
      if (shellEl) {
        const wrap = document.createElement("div");
        wrap.innerHTML = cocktailListShellHtml(cocktails);
        const next = wrap.firstElementChild;
        if (next) shellEl.replaceWith(next);
      }
      scheduleAlphaIndexSync();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm && e.target.name === "search") {
      state.rimmerSearch = e.target.value;
      render();
    }
  }

  function onChange(e) {
    const listForm = e.target.closest("[data-list-filters]");
    if (listForm && ["spirit", "sort", "available", "favorites"].includes(e.target.name)) {
      state.spirit = listForm.spirit.value;
      state.sort = listForm.sort.value;
      state.availableOnly = listForm.available.checked;
      state.favoritesOnly = listForm.favorites.checked;
      saveListPrefs();
      render();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm && (e.target.name === "kind" || e.target.name === "favorites" || e.target.name === "available")) {
      state.rimmerKind = rimmerForm.kind.value;
      state.rimmerFavoritesOnly = rimmerForm.favorites ? rimmerForm.favorites.checked : false;
      state.rimmerAvailableOnly = rimmerForm.available ? rimmerForm.available.checked : false;
      render();
      return;
    }

    const adminKind = e.target.closest("[data-admin-kind]");
    if (adminKind) {
      if (state.cameraOn) stopCamera();
      state.adminKind = adminKind.value;
      render();
    }
  }

  async function boot() {
    root.innerHTML = `<div class="boot">Loading Bartesian…</div>`;
    try {
      await BartesianDB.init();
      syncAdminFromDb();
      render();
    } catch (err) {
      root.innerHTML = `<div class="boot error">Failed to start: ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.historyModal) {
      state.historyModal = null;
      render();
    }
  });
  document.addEventListener("click", (e) => {
    onClick(e).catch((err) => {
      state.flash = err.message;
      render();
    });
  });
  document.addEventListener("submit", (e) => {
    onSubmit(e).catch((err) => {
      state.flash = err.message;
      render();
    });
  });
  document.addEventListener("input", onInput);
  document.addEventListener("change", (e) => {
    if (e.target && e.target.matches("[data-image-pick]")) {
      onImagePicked(e.target).catch((err) => {
        state.flash = err.message;
        render();
      });
      return;
    }
    onChange(e);
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const nav = e.target.closest("[data-alpha-index]");
      if (!nav) return;
      alphaScrubbing = true;
      try {
        nav.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      const letter = letterFromIndexPointer(nav, e.clientY);
      if (letter) jumpToIndexLetter(letter);
    },
    { passive: true }
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!alphaScrubbing) return;
      const nav =
        e.target.closest("[data-alpha-index]") || root.querySelector("[data-alpha-index]");
      if (!nav) return;
      const letter = letterFromIndexPointer(nav, e.clientY);
      if (letter) jumpToIndexLetter(letter);
    },
    { passive: true }
  );
  function endAlphaScrub() {
    alphaScrubbing = false;
    scheduleAlphaIndexSync();
  }
  document.addEventListener("pointerup", endAlphaScrub);
  document.addEventListener("pointercancel", endAlphaScrub);
  window.addEventListener("scroll", scheduleAlphaIndexSync, { passive: true });
  window.addEventListener("resize", scheduleAlphaIndexSync, { passive: true });

  boot();
})();
