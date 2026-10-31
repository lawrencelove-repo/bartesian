(function () {
  /** Keep in sync with sw.js CACHE_VERSION */
  const APP_VERSION = "bartesian-v78";
  const LIST_PREFS_COOKIE = "bartesian_list_prefs";
  // v2: panel-era tune values (Size relative to a 50% panel) are meaningless
  // in the viewport model and made images zoom/crop unexpectedly, so the
  // old cookie is ignored and tuning starts fresh at Shift 0 / Y 0 / 100%.
  const BOOK_TUNE_COOKIE = "bartesian_book_tune_v2";
  const UI_PREFS_COOKIE = "bartesian_ui_prefs";
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
    sort: "spirit",
    spirit: "",
    favoritesOnly: false,
    availableOnly: false,
    rimmerSearch: "",
    rimmerKind: "",
    rimmerFavoritesOnly: false,
    rimmerAvailableOnly: false,
    qtyOpenKey: "",
    historyModal: null,
    useModal: null,
    randomModal: null,
    scanMatchModal: null,
    adminItemDraft: null,
    /** Cocktail ids shown on Pack Admin edit (qty≥1 plus any added this session). */
    packEditIds: null,
    packEditKey: "",
    peopleEditId: null,
    flash: "",
    randomSpirit: "",
    randomFavoritesOnly: false,
    packSearch: "",
    scanPreview: null,
    scanDelta: -1,
    scanNameQuery: "",
    adminCode: "",
    adminKind: "capsule",
    adminCocktailId: "",
    adminLookupNote: "",
    cameraOn: false,
    cameraStatus: "",
    isAdmin: false,
    bookMenuOpen: false,
    bookTuneOpen: false,
    // In-progress per-cocktail Book Mode edit. Only written to the DB on Save;
    // switching cocktails/pages without saving discards this draft.
    // Shape: { cocktailId, form, orientation, x, y, scale, imageCut, dirty }
    bookTuneDraft: null,
    // Dragged Tune panel position (px within .book-mode). Kept until the
    // edit session ends (Close / leave Book Mode), including across pages.
    bookTunePanelPos: null,
    // Admin display toggles (Settings; cookie bartesian_ui_prefs)
    showBookTuneBtn: true,
    showAdminImageCut: true,
  };

  let bookTouchStartX = 0;
  let bookTouchStartY = 0;
  let bookTouchActive = false;
  let bookTuneDrag = null; // { pointerId, startX, startY, origLeft, origTop, root }

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

  /** Which form-factor bucket the current viewport belongs to (legacy key). */
  function bookFormKey() {
    const mq = (q) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    if (mq("(pointer: coarse) and (orientation: landscape) and (min-width: 768px) and (min-height: 600px)")) return "ipad-landscape";
    if (mq("(pointer: coarse) and (orientation: portrait) and (min-width: 600px)")) return "ipad-portrait";
    if (mq("(pointer: coarse) and (orientation: portrait) and (max-width: 599px)")) return "iphone-portrait";
    if (mq("(pointer: coarse) and (orientation: landscape) and (max-height: 599px)")) return "iphone-landscape";
    if (mq("(hover: hover) and (pointer: fine)")) return "desktop";
    return (window.innerWidth || 0) >= (window.innerHeight || 0) ? "landscape" : "portrait";
  }

  /** Form factor + orientation for Book Mode persistence (data/book.json). */
  function bookDeviceInfo() {
    const key = bookFormKey();
    if (key === "ipad-landscape") return { form: "ipad", orientation: "landscape", key };
    if (key === "ipad-portrait") return { form: "ipad", orientation: "portrait", key };
    if (key === "iphone-portrait") return { form: "iphone", orientation: "portrait", key };
    if (key === "iphone-landscape") return { form: "iphone", orientation: "landscape", key };
    const orientation =
      (window.innerWidth || 0) >= (window.innerHeight || 0) ? "landscape" : "portrait";
    if (key === "desktop") return { form: "desktop", orientation, key: "desktop-" + orientation };
    return { form: "desktop", orientation, key: "desktop-" + orientation };
  }

  function bakedBookTuneFor(device) {
    const form = device && device.form;
    const orient = device && device.orientation;
    if (form === "ipad" && orient === "landscape") return { x: -64, y: 12, scale: 1.3 };
    if (form === "ipad" && orient === "portrait") return { x: -66, y: 4, scale: 1.35 };
    if (form === "iphone" && orient === "portrait") return { x: -8, y: -32, scale: 1.35 };
    if (form === "iphone" && orient === "landscape") return { x: -68, y: 26, scale: 1.5 };
    if (form === "desktop") return { x: -78, y: 20, scale: 1.45 };
    return bakedBookTune();
  }

  /** Global default for this device: DB book_globals, else baked CSS values. */
  function globalBookLayout(device) {
    const d = device || bookDeviceInfo();
    const fromDb = BartesianDB.getBookGlobal(d.form, d.orientation);
    if (fromDb) return { ...fromDb, source: "global" };
    const baked = bakedBookTuneFor(d);
    return { ...(baked || { x: 0, y: 0, scale: 1 }), source: "baked" };
  }

  /** Image cut for Book Mode: book settings first, else cocktail.txt legacy. */
  function bookImageCutFor(cocktail) {
    if (!cocktail) return "NA";
    const fromBook = BartesianDB.getBookCocktailImageCut(cocktail.id);
    if (fromBook) return fromBook;
    const legacy = String(cocktail.image_cut || "NA");
    return ["Left", "Right"].includes(legacy) ? legacy : "NA";
  }

  /**
   * Effective layout for a cocktail on this device.
   * Draft (if editing this cocktail) > saved cocktail layout > global > baked.
   */
  function effectiveBookLayout(cocktail) {
    const d = bookDeviceInfo();
    const draft = state.bookTuneDraft;
    if (draft && cocktail && draft.cocktailId === cocktail.id) {
      return {
        x: draft.x,
        y: draft.y,
        scale: draft.scale,
        imageCut: draft.imageCut,
        form: draft.form,
        orientation: draft.orientation,
        source: "draft",
        dirty: !!draft.dirty,
      };
    }
    const cut = bookImageCutFor(cocktail);
    if (cocktail) {
      const saved = BartesianDB.getBookCocktailLayout(cocktail.id, d.form, d.orientation);
      if (saved) {
        return { ...saved, imageCut: cut, form: d.form, orientation: d.orientation, source: "cocktail", dirty: false };
      }
    }
    const g = globalBookLayout(d);
    return { ...g, imageCut: cut, form: d.form, orientation: d.orientation, dirty: false };
  }

  function beginBookTuneDraft(cocktailId) {
    const c = BartesianDB.getCocktail(cocktailId);
    if (!c) return;
    const d = bookDeviceInfo();
    // Prefer saved cocktail layout; otherwise start from the current global.
    const saved = BartesianDB.getBookCocktailLayout(c.id, d.form, d.orientation);
    const base = saved || globalBookLayout(d);
    state.bookTuneDraft = {
      cocktailId: c.id,
      form: d.form,
      orientation: d.orientation,
      x: base.x,
      y: base.y,
      scale: base.scale,
      imageCut: bookImageCutFor(c),
      dirty: false,
    };
  }

  function discardBookTuneDraft() {
    state.bookTuneDraft = null;
  }

  /** End the Tune edit session: drop draft + forget dragged panel position. */
  function endBookTuneSession() {
    discardBookTuneDraft();
    state.bookTuneOpen = false;
    state.bookTunePanelPos = null;
    bookTuneDrag = null;
  }

  function bookTunePanelStyle() {
    const pos = state.bookTunePanelPos;
    if (!pos) return "";
    return `left:${pos.left}px;top:${pos.top}px;right:auto;bottom:auto;transform:none;`;
  }

  function clampBookTunePanelPos(root, left, top, panelW, panelH) {
    const rw = root.clientWidth || 0;
    const rh = root.clientHeight || 0;
    const maxL = Math.max(0, rw - panelW);
    const maxT = Math.max(0, rh - panelH);
    return {
      left: Math.min(maxL, Math.max(0, left)),
      top: Math.min(maxT, Math.max(0, top)),
    };
  }

  function adjustBookTune(action) {
    if (!state.bookTuneDraft) return;
    const t = { ...state.bookTuneDraft };
    const STEP = 2;
    // X is stored as a shift toward the center spine: it is applied
    // mirrored on right-hand pages (see bookTuneStyle). The arrow buttons
    // always move the photo in the arrow's direction on screen, so on a
    // right-hand page they adjust the stored shift in the opposite sense.
    // Left vs right page (and form factor) therefore share one stored X;
    // cut side only flips the bitmap, it does not invert the shift.
    const spreadEl = document.querySelector("[data-book-spread]");
    const onLeftPage = !spreadEl || spreadEl.classList.contains("image-left");
    if (action === "left") t.x += onLeftPage ? -STEP : STEP;
    else if (action === "right") t.x += onLeftPage ? STEP : -STEP;
    else if (action === "up") t.y -= STEP;
    else if (action === "down") t.y += STEP;
    else if (action === "bigger") t.scale = Math.round((t.scale + 0.05) * 100) / 100;
    else if (action === "smaller") t.scale = Math.round((t.scale - 0.05) * 100) / 100;
    else if (action === "reset") {
      const g = globalBookLayout({ form: t.form, orientation: t.orientation });
      t.x = g.x;
      t.y = g.y;
      t.scale = g.scale;
      t.dirty = true;
      state.bookTuneDraft = t;
      render();
      return;
    }
    t.x = Math.min(100, Math.max(-100, t.x));
    t.y = Math.min(100, Math.max(-100, t.y));
    t.scale = Math.min(2, Math.max(0.5, t.scale));
    t.dirty = true;
    t.status = "";
    state.bookTuneDraft = t;
    render();
  }

  async function saveBookTuneCocktail() {
    const d = state.bookTuneDraft;
    if (!d) return;
    await BartesianDB.saveBookCocktailTune({
      cocktailId: d.cocktailId,
      formFactor: d.form,
      orientation: d.orientation,
      x: d.x,
      y: d.y,
      scale: d.scale,
      imageCut: d.imageCut,
    });
    d.dirty = false;
    d.status = "Saved for this cocktail · " + d.form + " · " + d.orientation;
    state.bookTuneDraft = d;
    render();
  }

  async function saveBookTuneGlobal() {
    const d = state.bookTuneDraft;
    if (!d) return;
    await BartesianDB.saveBookGlobalTune({
      formFactor: d.form,
      orientation: d.orientation,
      x: d.x,
      y: d.y,
      scale: d.scale,
    });
    d.status = "Saved as global default · " + d.form + " · " + d.orientation;
    // Global changed — draft is no longer "dirty" relative to cocktail save,
    // but cocktail-specific override was not written.
    state.bookTuneDraft = d;
    render();
  }

  function loadUiPrefs() {
    try {
      const raw = getCookie(UI_PREFS_COOKIE);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.showBookTuneBtn === "boolean") state.showBookTuneBtn = p.showBookTuneBtn;
      if (typeof p.showAdminImageCut === "boolean") state.showAdminImageCut = p.showAdminImageCut;
    } catch (_) {
      /* ignore bad cookie */
    }
  }

  function saveUiPrefs() {
    setCookie(
      UI_PREFS_COOKIE,
      JSON.stringify({
        showBookTuneBtn: state.showBookTuneBtn,
        showAdminImageCut: state.showAdminImageCut,
      })
    );
  }

  loadListPrefs();
  loadUiPrefs();
  // Clear legacy global tune cookie — per-cocktail layouts live in the DB / book.json.
  try {
    setCookie(BOOK_TUNE_COOKIE, "", 0);
  } catch (_) {}

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

  function scanMatchFromPreview(preview) {
    if (!preview || !preview.ok) return null;
    const first = (preview.proposed || [])[0] || {};
    let name = preview.targetName || first.name || "Matched item";
    let image = first.image || "";
    const kind = preview.kind || "";
    if ((kind === "capsule" || kind === "case") && first.id) {
      const c = BartesianDB.getCocktail(first.id);
      if (c) {
        name = c.name || name;
        image = c.marketing_image || c.hero_image || c.image || image;
      }
    } else if (kind === "rimmer" && first.id) {
      const r = BartesianDB.getRimmer(first.id);
      if (r) {
        name = r.name || name;
        image = r.image || image;
      }
    } else if (kind === "variety_pack" && preview.packId) {
      const p = BartesianDB.getPack(preview.packId);
      if (p) {
        name = p.name || name;
        image = p.image || image;
      }
    } else if (first.id && !image) {
      const c = BartesianDB.getCocktail(first.id);
      if (c) image = c.marketing_image || c.hero_image || c.image || "";
    }
    return {
      name,
      image,
      kindLabel: preview.kindLabel || "",
    };
  }

  function applyScannedCode(code, target) {
    const normalized = BartesianBarcodes.normalizeCode(code);
    if (!normalized) return;
    if (target === "admin") {
      applyAdminLookup(normalized);
      stopCamera();
      const adminPreview = BartesianBarcodes.resolve(BartesianDB, normalized, {
        capsuleDelta: -1,
        rimmerDelta: -1,
      });
      state.scanMatchModal = scanMatchFromPreview(adminPreview);
      render();
      return;
    }

    // Default: scan inventory page
    state.scanDelta = -1;
    state.scanPreview = BartesianBarcodes.resolve(BartesianDB, normalized, {
      capsuleDelta: state.scanDelta,
      rimmerDelta: state.scanDelta,
    });
    state.scanMatchModal = scanMatchFromPreview(state.scanPreview);
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
    if (parts[0] === "pack" && parts[1]) {
      return { view: "pack-detail", id: Number(parts[1]) };
    }
    if (parts[0] === "packs") return { view: "packs" };
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
    if (parts[0] === "admin" && ["cocktails", "rimmers", "packs"].includes(parts[1])) {
      const singular = parts[1] === "cocktails" ? "cocktail" : parts[1] === "rimmers" ? "rimmer" : "pack";
      if (parts[2] === "new") return { view: "admin-item-edit", itemType: singular, id: null };
      if (parts[2] === "edit" && parts[3]) return { view: "admin-item-edit", itemType: singular, id: Number(parts[3]) };
    }
    if (parts[0] === "admin" && parts[1] === "cocktails") return { view: "admin-cocktails" };
    if (parts[0] === "admin" && parts[1] === "rimmers") return { view: "admin-rimmers" };
    if (parts[0] === "admin" && parts[1] === "packs") return { view: "admin-packs" };
    if (parts[0] === "admin" && parts[1] === "people") return { view: "admin-people" };
    if (parts[0] === "admin" && parts[1] === "scan") return { view: "scan" };
    if (parts[0] === "admin") return { view: "admin-barcodes" };
    if (parts[0] === "disclaimer") return { view: "disclaimer" };
    if (parts[0] === "book") {
      if (parts[1]) return { view: "book", id: Number(parts[1]) };
      return { view: "book", id: null };
    }
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
    "admin-packs", "admin-people", "people", "admin-item-edit",
  ];

  function shell(active, body) {
    const nav = [
      ["list", "#/", "Cocktails"],
      ["rimmers", "#/rimmers", "Rimmers"],
      ["packs", "#/packs", "Packs"],
      ["restock", "#/restock", "Restock"],
      ["wishlist", "#/wishlist", "Wishlist"],
      ["random", "#/random", "Random"],
      ["book", "#/book", "Book"],
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
          <span>${
            window.BARTESIAN_CLOUDFLARE
              ? "Private use only · data stored in Cloudflare D1"
              : "Private use only · data in git, edits local until export"
          }</span>
        </footer>
        <button type="button" class="back-to-top" data-back-to-top aria-label="Back to top">↑ Back to Top</button>
      </div>
    `;
  }

  function syncBackToTop() {
    const btn = root.querySelector("[data-back-to-top]");
    if (!btn) return;
    btn.classList.toggle("is-visible", window.scrollY > 240);
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
            <div class="toolbar-search-wrap">
              <input type="search" name="search" placeholder="Search" value="${esc(state.search)}" />
              ${
                state.search
                  ? `<button type="button" class="toolbar-search-clear" data-search-clear aria-label="Clear search">×</button>`
                  : ""
              }
            </div>
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
              <option value="spirit" ${state.sort === "spirit" ? "selected" : ""}>Spirit</option>
              <option value="name" ${state.sort === "name" ? "selected" : ""}>Name A–Z</option>
              <option value="name-desc" ${state.sort === "name-desc" ? "selected" : ""}>Name Z–A</option>
              <option value="quantity" ${state.sort === "quantity" ? "selected" : ""}>Quantity ↓</option>
              <option value="quantity-asc" ${state.sort === "quantity-asc" ? "selected" : ""}>Quantity ↑</option>
              <option value="rating" ${state.sort === "rating" ? "selected" : ""}>Rating</option>
              <option value="seasonal" ${state.sort === "seasonal" ? "selected" : ""}>Seasonal</option>
            </select>
          </div>
          <div class="toolbar-checks">
            <label class="check"><input type="checkbox" name="available" ${state.availableOnly ? "checked" : ""}/> In stock</label>
            <label class="check"><input type="checkbox" name="favorites" ${state.favoritesOnly ? "checked" : ""}/> Favorites</label>
          </div>
        </form>
        ${cocktailListCountHtml(cocktails)}
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

  function nutritionBlock(nutrition, rawFallback, { asSectionInner = false } = {}) {
    const labelImage = nutrition && nutrition.label_image;
    // Prefer the normal (non-EU) label; only show EU when it's the only image.
    const euImage =
      !labelImage && nutrition && nutrition.label_image_eu
        ? nutrition.label_image_eu
        : "";
    const image = labelImage || euImage;
    if (image) {
      const body = `
        <p class="detail-copy muted">Case label (nutrition, ingredients, UPC)</p>
        <a class="nutrition-label" href="${esc(image)}" target="_blank" rel="noopener">
          <img src="${esc(image)}" alt="Nutrition label">
        </a>`;
      if (asSectionInner) return body;
      return `<section class="nutrition-section">
        <p class="section-label">Nutrition</p>
        ${body}
      </section>`;
    }
    if (!nutrition && !rawFallback) return "";
    const text = nutrition
      ? Object.entries(nutrition)
          .filter(([k]) => k !== "label_image" && k !== "label_image_eu")
          .map(([k, v]) => k + ": " + v)
          .join(", ")
      : rawFallback;
    if (!text) return "";
    if (asSectionInner) return `<p class="detail-copy">${esc(text)}</p>`;
    return `<p class="section-label">Nutrition</p><p class="detail-copy">${esc(text)}</p>`;
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
    const T = window.BartesianItemTemplates;

    const packList = packs.length
      ? `<div class="list">${packs
          .map((p) => {
            const thumb = p.image || "";
            return `
              <a class="cocktail-row" href="#/pack/${p.id}" data-go="#/pack/${p.id}">
                <span class="qty-badge" aria-label="${p.pack_qty} in pack">×${p.pack_qty}</span>
                <div class="thumb ${thumb ? "" : "thumb-empty"}">
                  ${thumb ? `<img src="${esc(thumb)}" alt="">` : ""}
                </div>
                <div class="row-body">
                  <div class="row-title">${esc(p.name)}</div>
                  <div class="row-meta">${p.pack_qty} in pack</div>
                </div>
              </a>`;
          })
          .join("")}</div>`
      : `<p class="muted">Not in any variety packs (yet).</p>`;

    const rimmerList = rimmers.length
      ? `<div class="list rimmer-pair-list">${rimmers
          .map((r) => {
            const kind = (r.kind || "rimmer").replace(/^./, (ch) => ch.toUpperCase());
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

    const parts = {
      hero: `
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
            ${externalLinkHtml(c.bartesian_url, "View on Bartesian")}
            ${
              c.help_url
                ? `<p class="muted"><a href="${esc(c.help_url)}" target="_blank" rel="noopener">Nutrition / help article ${arrowGlyph()}</a></p>`
                : ""
            }
          </div>
        </div>`,
      // Description already appears in the hero — only Details / Alcohol / Product here.
      detail_layout: `
        <div class="detail-layout">
          <div>
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
        </div>`,
      inventory: `
        <div class="inventory-box">
          <p class="qty-display"><span data-qty>${c.quantity}</span> capsule${c.quantity === 1 ? "" : "s"}</p>
          <div class="qty-actions">
            <button type="button" data-qty-delta="-1" data-id="${c.id}">−</button>
            <button type="button" data-use-one data-id="${c.id}" data-name="${esc(c.name)}">Use 1</button>
            <button type="button" data-qty-delta="1" data-id="${c.id}">+</button>
            <button type="button" class="ghost" data-toggle-fav data-id="${c.id}" data-on="${c.favorite ? 1 : 0}">
              ${c.favorite ? "Remove from Favorites" : "Add to Favorites"}
            </button>
            <button type="button" class="ghost" data-wishlist-add-cocktail="${c.id}">Add to Wishlist</button>
            <button type="button" class="ghost" data-go="#/history/cocktail/${c.id}">History</button>
            ${c.restock && c.quantity === 0 ? '<span class="pill pill-restock">Restock needed</span>' : ""}
          </div>
        </div>`,
      variety_packs: packList,
      recommended_rimmers: rimmerList,
      ratings: `
        <ul class="plain">${ratingRows}</ul>
        <form class="rating-form" data-rating-form data-id="${c.id}">
          <select name="person_id" required>
            <option value="">Person…</option>
            ${people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
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
        </form>`,
      nutrition: nutritionBlock(nutrition, c.nutrition_json, { asSectionInner: true }),
    };

    const body =
      T && T.renderSections
        ? T.renderSections("cocktail", parts)
        : Object.values(parts).join("\n");

    return shell(
      "list",
      `<section class="panel detail">${body}</section>${useModalHtml(people)}`
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
    const T = window.BartesianItemTemplates;
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

    const parts = {
      hero: `
        <a class="back" href="#/rimmers" data-go="#/rimmers">← All rimmers</a>
        <div class="detail-hero">
          <div class="thumb large ${r.image ? "" : "thumb-empty"}">
            ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
          </div>
          <div>
            <p class="detail-kicker">${esc((r.kind || "rimmer").replace(/^./, (ch) => ch.toUpperCase()))} rimmer</p>
            <h1 class="detail-title">${esc(r.name)}${r.favorite ? " ★" : ""}</h1>
            <p class="detail-copy">${esc(r.description || "")}</p>
            ${externalLinkHtml(r.bartesian_url, "View on Bartesian")}
          </div>
        </div>`,
      nutrition: r.nutrition_image
        ? `<a class="nutrition-label" href="${esc(r.nutrition_image)}" target="_blank" rel="noopener">
             <img src="${esc(r.nutrition_image)}" alt="Nutrition label">
           </a>`
        : "",
      inventory: `
        <div class="inventory-box">
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
        </div>`,
      cocktail_pairings: cocktailList,
    };

    const body =
      T && T.renderSections
        ? T.renderSections("rimmer", parts)
        : Object.values(parts).join("\n");

    return shell("rimmers", `<section class="panel detail">${body}</section>`);
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const T = window.BartesianActivityTemplates;
    if (T && T.formatWhen) return T.formatWhen(iso);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  function activityLabel(a) {
    const T = window.BartesianActivityTemplates;
    if (T && T.activityLabel) return T.activityLabel(a);
    return a.cocktail_name || a.rimmer_name || a.pack_name || a.kind || "Event";
  }

  function activityRowsHtml(rows, emptyText) {
    if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
    const T = window.BartesianActivityTemplates;
    return rows.map((a) => {
      const formatted = T && T.formatActivity
        ? T.formatActivity(a)
        : { title: activityLabel(a), meta: formatWhen(a.created_at) };
      const adminBtns = state.isAdmin
        ? `<div class="row-actions history-actions">
             <button type="button" class="btn-edit small" data-history-edit="${a.id}">Edit</button>
             <button type="button" class="ghost danger small" data-history-delete="${a.id}">Delete</button>
           </div>`
        : "";
      const inner = `
        <div class="row-body">
          <div class="row-title">${esc(formatted.title)}</div>
          <div class="row-meta">${esc(formatted.meta)}</div>
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
        ? personComboHtml({
            label: m.kind === "use" ? "Consumed / used by" : "Added by",
            value: m.personName || "",
            people: people || [],
            hint: "Pick from the list or type a name. A new name is added as a Person.",
          })
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

  /** External-link arrow: SVG so desktop doesn't get a skinny Unicode ↗. */
  function arrowGlyph() {
    return `<span class="icon-link-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11L11 5M11 5H6.5M11 5V9.5"/></svg></span>`;
  }

  function bartesianArrow(url) {
    if (!url) return "";
    return `<a class="icon-link" href="${esc(url)}" target="_blank" rel="noopener" aria-label="View on Bartesian" title="View on Bartesian">${arrowGlyph()}</a>`;
  }

  function externalLinkHtml(url, label) {
    if (!url) return "";
    return `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ${arrowGlyph()}</a></p>`;
  }

  /**
   * Single-field person combobox with a custom dropdown overlay (works on iOS;
   * native <datalist> does not). Type freely or pick from the list.
   */
  function personComboHtml({
    name = "person_name",
    label = "Person",
    optional = true,
    value = "",
    people = [],
    hint = "",
  } = {}) {
    const current = String(value || "");
    const peopleList = people || [];
    const options = peopleList
      .map(
        (p) =>
          `<button type="button" class="person-combo-option" data-person-combo-option role="option">${esc(p.name)}</button>`
      )
      .join("");
    return `
      <label class="person-combo-label">${esc(label)}${optional ? ' <span class="muted">(optional)</span>' : ""}
        <div class="person-combo" data-person-combo>
          <div class="person-combo-control">
            <input name="${esc(name)}" type="text" data-person-combo-input placeholder="Leave blank, or any name" value="${esc(current)}" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox" />
            <button type="button" class="person-combo-toggle" data-person-combo-toggle aria-label="Show people" tabindex="-1">▾</button>
          </div>
          <div class="person-combo-menu" data-person-combo-menu role="listbox" hidden>
            ${
              options ||
              `<p class="person-combo-empty muted">No people yet — type a name.</p>`
            }
          </div>
        </div>
      </label>
      ${hint ? `<p class="hint">${hint}</p>` : ""}`;
  }

  function closeAllPersonCombos(except) {
    root.querySelectorAll("[data-person-combo].is-open").forEach((combo) => {
      if (except && combo === except) return;
      combo.classList.remove("is-open");
      const menu = combo.querySelector("[data-person-combo-menu]");
      const input = combo.querySelector("[data-person-combo-input]");
      if (menu) menu.hidden = true;
      if (input) input.setAttribute("aria-expanded", "false");
    });
  }

  function openPersonCombo(combo) {
    if (!combo) return;
    closeAllPersonCombos(combo);
    combo.classList.add("is-open");
    const menu = combo.querySelector("[data-person-combo-menu]");
    const input = combo.querySelector("[data-person-combo-input]");
    if (menu) menu.hidden = false;
    if (input) input.setAttribute("aria-expanded", "true");
    filterPersonComboOptions(combo);
  }

  function filterPersonComboOptions(combo) {
    if (!combo) return;
    const input = combo.querySelector("[data-person-combo-input]");
    const q = String((input && input.value) || "")
      .trim()
      .toLowerCase();
    let visible = 0;
    combo.querySelectorAll("[data-person-combo-option]").forEach((btn) => {
      const name = String(btn.textContent || "").toLowerCase();
      const show = !q || name.includes(q);
      btn.hidden = !show;
      if (show) visible++;
    });
    const empty = combo.querySelector(".person-combo-empty");
    if (empty) empty.hidden = visible > 0 || !!q;
  }

  function useModalHtml(people) {
    const m = state.useModal;
    if (!m) return "";
    return `<div class="modal-backdrop" data-use-modal-backdrop>
      <div class="modal use-modal" role="dialog" aria-modal="true" aria-labelledby="use-modal-title" data-use-modal-dialog>
        <h2 id="use-modal-title">Use 1 capsule</h2>
        <p>${esc(m.name)}</p>
        <form class="modal-form" data-use-one-form data-id="${m.id}">
          ${personComboHtml({
            label: "Consumed / used by",
            value: "",
            people: people || [],
            hint: "Pick from the list or type a name. Leave blank if you prefer.",
          })}
          <div class="modal-actions">
            <button type="button" class="ghost" data-use-modal-close>Cancel</button>
            <button type="submit">Use 1</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  function randomModalHtml() {
    const pick = state.randomModal;
    if (!pick) return "";
    if (pick.empty) {
      return `<div class="modal-backdrop random-modal-backdrop" data-random-modal-backdrop>
        <div class="modal random-modal" role="dialog" aria-modal="true" data-random-modal-dialog>
          <h2>No match</h2>
          <p class="error">No matching in-stock cocktails.</p>
          <div class="random-modal-actions">
            <button type="button" class="ghost" data-random-modal-close>Close</button>
            <button type="button" data-random-try-again>Try again</button>
          </div>
        </div>
      </div>`;
    }
    const pickImg = primaryImage(pick);
    const pickSpirits = (pick.spirits_csv || "").split("|").filter(Boolean).join(", ");
    return `<div class="modal-backdrop random-modal-backdrop" data-random-modal-backdrop>
      <div class="modal random-modal" role="dialog" aria-modal="true" aria-labelledby="random-modal-title" data-random-modal-dialog>
        <div class="detail-hero">
          <a class="thumb large ${pickImg ? "" : "thumb-empty"}" href="#/cocktail/${pick.id}" data-go="#/cocktail/${pick.id}" aria-label="${esc(pick.name)}">
            ${pickImg ? `<img src="${esc(pickImg)}" alt="">` : ""}
          </a>
          <div>
            <p class="detail-kicker">Cocktail${pick.seasonal ? " · Seasonal" : ""}</p>
            <h2 id="random-modal-title" class="detail-title random-title">
              <a class="random-title-link" href="#/cocktail/${pick.id}" data-go="#/cocktail/${pick.id}">${esc(pick.name)}${pick.favorite ? " ★" : ""}</a>
            </h2>
            ${pickSpirits ? `<p class="spirits">${esc(pickSpirits)}</p>` : ""}
            <p class="detail-copy">${esc(pick.description || "")}</p>
            <p class="muted">Qty ${pick.quantity} · ${starsLabel(pick.avg_rating)}${pick.glassware ? " · " + esc(pick.glassware) : ""}</p>
          </div>
        </div>
        <div class="random-modal-actions">
          <button type="button" class="ghost" data-random-modal-close>Close</button>
          <button type="button" data-random-try-again>Try again</button>
        </div>
      </div>
    </div>`;
  }

  function scanMatchModalHtml() {
    const m = state.scanMatchModal;
    if (!m) return "";
    return `<div class="modal-backdrop scan-match-backdrop" data-scan-match-backdrop>
      <div class="modal scan-match-modal" role="dialog" aria-modal="true" aria-labelledby="scan-match-title">
        <div class="thumb large ${m.image ? "" : "thumb-empty"}">
          ${m.image ? `<img src="${esc(m.image)}" alt="">` : ""}
        </div>
        <h2 id="scan-match-title">${esc(m.name)}</h2>
        ${m.kindLabel ? `<p class="muted">${esc(m.kindLabel)}</p>` : ""}
        <p class="hint">Tap anywhere to close</p>
      </div>
    </div>`;
  }

  function cocktailListCountHtml(cocktails) {
    const n = cocktails.length;
    let text = `${n} cocktail${n === 1 ? "" : "s"}`;
    if (state.availableOnly) {
      const capsules = cocktails.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0);
      text += ` (${capsules} capsule${capsules === 1 ? "" : "s"})`;
    }
    return `<p class="count">${text}</p>`;
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
            <button type="button" class="ghost ${state.scanDelta === 1 ? "on" : ""}" data-scan-delta="1">Restock (+1)</button>
            ${preview.kind === "capsule" ? `<button type="button" class="ghost ${state.scanDelta === 8 ? "on" : ""}" data-scan-delta="8">Pack (Add +8)</button>` : ""}
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
    const pickers = `
      <div class="camera-actions">
        <button type="button" data-camera-start="${esc(target)}">Live scan</button>
      </div>
      <p class="hint">Live scan needs camera permission in Safari/PWA.</p>`;

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

  function scanNameResultsHtml() {
    const q = state.scanNameQuery.trim().toLowerCase();
    if (!q) return "";
    const matches = (items) =>
      items.filter((x) => String(x.name || "").toLowerCase().includes(q)).slice(0, 8);
    const cocktails = matches(BartesianDB.listAllCocktails());
    const rimmers = matches(BartesianDB.listAllRimmersAdmin());
    // Disabled packs (e.g. EU/UK) don't show in scan name search
    const packs = matches(BartesianDB.listAllPacksAdmin()).filter((p) => p.enabled);
    if (!cocktails.length && !rimmers.length && !packs.length) {
      return `<p class="empty">No cocktails, rimmers, or packs match “${esc(state.scanNameQuery.trim())}”.</p>`;
    }
    const cocktailRows = cocktails.map((c) => `
      <div class="cocktail-row scan-pick" data-scan-pick="cocktail:${c.id}" role="button" tabindex="0">
        <span class="qty-badge ${qtyBadgeClass(Number(c.quantity) || 0, c.restock)}">${c.quantity}</span>
        <div class="thumb ${primaryImage(c) ? "" : "thumb-empty"}">${primaryImage(c) ? `<img src="${esc(primaryImage(c))}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title">${esc(c.name)}${c.enabled ? "" : ' <span class="pill">Disabled</span>'}</div>
          <div class="row-meta">Cocktail · qty ${c.quantity}</div>
        </div>
      </div>`).join("");
    const rimmerRows = rimmers.map((r) => `
      <div class="cocktail-row scan-pick" data-scan-pick="rimmer:${r.id}" role="button" tabindex="0">
        <span class="qty-badge ${rimmerQtyBadgeClass(Number(r.quantity) || 0, r.restock)}">${r.quantity}</span>
        <div class="thumb ${r.image ? "" : "thumb-empty"}">${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title">${esc(r.name)}${r.enabled ? "" : ' <span class="pill">Disabled</span>'}</div>
          <div class="row-meta">Rimmer · qty ${r.quantity}</div>
        </div>
      </div>`).join("");
    const packRows = packs.map((p) => {
      const count = BartesianDB.getPackItems(p.id).length;
      return `
      <div class="cocktail-row scan-pick" data-scan-pick="pack:${p.id}" role="button" tabindex="0">
        <span aria-hidden="true"></span>
        <div class="thumb ${p.image ? "" : "thumb-empty"}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}</div>
        <div class="row-body">
          <div class="row-title">${esc(p.name)}${p.enabled ? "" : ' <span class="pill">Disabled</span>'}</div>
          <div class="row-meta">Variety pack · ${count} item${count === 1 ? "" : "s"}</div>
        </div>
      </div>`;
    }).join("");
    return `<div class="list scan-name-results">${cocktailRows}${rimmerRows}${packRows}</div>`;
  }

  function renderScan() {
    const previewHtml = scanPreviewHtml(state.scanPreview);
    return shell(
      "scan",
      `
      <section class="panel">
        <p class="section-label">Inventory</p>
        <h1>Scan barcode</h1>
        <p class="lede">Use the camera, a USB wedge scanner, type a code, or search by name. Nothing changes until you confirm.</p>
        <ul class="plain muted">
          <li>Capsule / rimmer → default <strong>−1</strong> (flip to +1 before confirm)</li>
          <li>Case → +case qty for that cocktail</li>
          <li>Variety pack → + each included cocktail</li>
        </ul>
        ${cameraPanelHtml("scan")}
        <form class="scan-form" data-scan-name-search>
          <input name="query" type="search" autocomplete="off" placeholder="Search by name (cocktail, rimmer, pack)" value="${esc(state.scanNameQuery)}" />
          <button type="submit">Search</button>
        </form>
        <div data-scan-name-results>${scanNameResultsHtml()}</div>
        <form class="scan-form" data-scan-lookup>
          <input name="code" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode" required ${state.cameraOn ? "" : "autofocus"} />
          <button type="submit">Look up</button>
        </form>
        <p class="hint">USB scanners type into the field (Enter = look up). Capsule lids use the Bartesian decoder; case/pack labels use a built-in UPC/EAN decoder (works on iPad).</p>
        <div data-scan-result>${previewHtml}</div>
      </section>
      ${scanMatchModalHtml()}
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
      ${scanMatchModalHtml()}
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
      </section>
      ${randomModalHtml()}
    `
    );
  }

  function renderPacks() {
    const packs = BartesianDB.listPacks({
      search: state.packSearch,
      enabledOnly: true,
    });
    const rows = packs
      .map((p) => {
        const items = BartesianDB.getPackItems(p.id);
        return `
          <a class="cocktail-row" href="#/pack/${p.id}" data-go="#/pack/${p.id}">
            <span class="qty-badge" aria-label="${items.length} cocktails">${items.length}</span>
            <div class="thumb ${p.image ? "" : "thumb-empty"}">
              ${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}
            </div>
            <div class="row-body">
              <div class="row-title">${esc(p.name)}</div>
              <div class="row-meta">${items.length} cocktail${items.length === 1 ? "" : "s"}</div>
            </div>
          </a>`;
      })
      .join("");
    return shell(
      "packs",
      `
      <section class="panel panel-list">
        <p class="section-label">Menu</p>
        <h1>Packs</h1>
        <form class="toolbar" data-pack-filters>
          <div class="toolbar-controls">
            <div class="toolbar-search-wrap">
              <input type="search" name="search" placeholder="Search" value="${esc(state.packSearch)}" />
              ${
                state.packSearch
                  ? `<button type="button" class="toolbar-search-clear" data-pack-search-clear aria-label="Clear search">×</button>`
                  : ""
              }
            </div>
          </div>
        </form>
        <p class="count">${packs.length} pack${packs.length === 1 ? "" : "s"}</p>
        <div class="list">${rows || `<p class="empty">No packs match.</p>`}</div>
      </section>`
    );
  }

  function renderPackDetail(id) {
    const p = BartesianDB.getPack(id);
    if (!p || !p.enabled) {
      return shell("packs", `<section class="panel"><p>Pack not found.</p></section>`);
    }
    const items = BartesianDB.getPackItems(id);
    const T = window.BartesianItemTemplates;
    const itemList = items.length
      ? `<div class="list">${items
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
                  <div class="row-meta">${c.qty} in pack</div>
                </div>
              </a>`;
          })
          .join("")}</div>`
      : `<p class="muted">No cocktails in this pack.</p>`;

    const parts = {
      hero: `
        <a class="back" href="#/packs" data-go="#/packs">← All packs</a>
        <div class="detail-hero">
          <div class="thumb large ${p.image ? "" : "thumb-empty"}">
            ${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}
          </div>
          <div>
            <p class="detail-kicker">Variety pack</p>
            <h1 class="detail-title">${esc(p.name)}</h1>
            ${p.notes ? `<p class="detail-copy">${esc(p.notes)}</p>` : ""}
            ${externalLinkHtml(p.bartesian_url, "View on Bartesian")}
            ${
              p.help_url
                ? `<p class="muted"><a href="${esc(p.help_url)}" target="_blank" rel="noopener">Help article ${arrowGlyph()}</a></p>`
                : ""
            }
          </div>
        </div>`,
      nutrition: p.nutrition_image
        ? `<a class="nutrition-label" href="${esc(p.nutrition_image)}" target="_blank" rel="noopener">
             <img src="${esc(p.nutrition_image)}" alt="Nutrition label">
           </a>`
        : "",
      pack_items: itemList,
    };

    const body =
      T && T.renderSections
        ? T.renderSections("pack", parts)
        : Object.values(parts).join("\n");

    return shell("packs", `<section class="panel detail">${body}</section>`);
  }

  function adminToggleBtn(attrs, on, labelOn, labelOff) {
    return `<button type="button" class="ghost small" ${attrs} data-on="${on ? 1 : 0}">${on ? labelOn : labelOff}</button>`;
  }

  function adminImageCutSelect(c) {
    const current = ["Left", "Right"].includes(c.image_cut) ? c.image_cut : "NA";
    const options = ["NA", "Left", "Right"]
      .map((opt) => `<option value="${opt}" ${opt === current ? "selected" : ""}>${opt}</option>`)
      .join("");
    return `<label class="admin-image-cut">Image Cut
      <select data-admin-cocktail-image-cut data-id="${c.id}" aria-label="Image Cut for ${esc(c.name)}">${options}</select>
    </label>`;
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
            ${state.showAdminImageCut ? adminImageCutSelect(c) : ""}
            <a class="btn-link small btn-edit" href="#/admin/cocktails/edit/${c.id}" data-go="#/admin/cocktails/edit/${c.id}">Edit</a>
          </div>
        </div>
      </div>`).join("");
    return shell("admin-cocktails", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Cocktails</h1>
        <p class="lede">Quick toggles for every cocktail (including disabled). Open a name for the full detail page.</p>
        <p><a class="btn-link" href="#/admin/cocktails/new" data-go="#/admin/cocktails/new">+ Add Cocktail</a></p>
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
            <a class="btn-link small btn-edit" href="#/admin/rimmers/edit/${r.id}" data-go="#/admin/rimmers/edit/${r.id}">Edit</a>
          </div>
        </div>
      </div>`).join("");
    return shell("admin-rimmers", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Rimmers</h1>
        <p class="lede">Edit name and type (free text — sugar, salt, candy, …), then Save. Export from Settings to write changes back to <code>data/rimmers/*.txt</code>.</p>
        <p><a class="btn-link" href="#/admin/rimmers/new" data-go="#/admin/rimmers/new">+ Add Rimmer</a></p>
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
            <a class="btn-link small btn-edit" href="#/admin/packs/edit/${p.id}" data-go="#/admin/packs/edit/${p.id}">Edit</a>
          </div>
        </div>
      </div>`;
    }).join("");
    return shell("admin-packs", `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Packs</h1>
        <p><a class="btn-link" href="#/admin/packs/new" data-go="#/admin/packs/new">+ Add Pack</a></p>
        <p class="count">${packs.length} packs</p>
        <div class="list">${rows || `<p class="empty">None.</p>`}</div>
      </section>`);
  }

  const ITEM_LABELS = { cocktail: "Cocktail", rimmer: "Rimmer", pack: "Pack" };
  const ITEM_LIST_HREF = { cocktail: "#/admin/cocktails", rimmer: "#/admin/rimmers", pack: "#/admin/packs" };
  const ITEM_LIST_SHELL = { cocktail: "admin-cocktails", rimmer: "admin-rimmers", pack: "admin-packs" };

  function itemField(v, name, label, opts) {
    const o = opts || {};
    const val = v[name] == null ? "" : v[name];
    if (o.type === "textarea") {
      return `<label>${esc(label)}<textarea name="${name}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || "")}">${esc(val)}</textarea></label>`;
    }
    if (o.type === "checkbox") {
      return `<label class="check form-check"><input type="checkbox" name="${name}" ${val ? "checked" : ""}/> ${esc(label)}</label>`;
    }
    if (o.type === "select") {
      const options = o.options || [];
      const current = val === "" || val == null ? options[0] : val;
      return `<label>${esc(label)}<select name="${name}">${options.map((opt) => `<option value="${esc(opt)}" ${String(opt) === String(current) ? "selected" : ""}>${esc(opt)}</option>`).join("")}</select></label>`;
    }
    return `<label>${esc(label)}<input name="${name}" type="${o.type || "text"}" value="${esc(val)}" ${o.required ? "required" : ""} ${o.list ? `list="${o.list}"` : ""} placeholder="${esc(o.placeholder || "")}" ${o.min != null ? `min="${o.min}"` : ""} ${o.step != null ? `step="${o.step}"` : ""}/></label>`;
  }

  function renderAdminItemEdit(itemType, id) {
    const label = ITEM_LABELS[itemType] || "Item";
    const isNew = id == null;
    let item = null;
    if (!isNew) {
      item =
        itemType === "cocktail" ? BartesianDB.getCocktailForEdit(id)
        : itemType === "rimmer" ? BartesianDB.getRimmerForEdit(id)
        : BartesianDB.getPackForEdit(id);
      if (!item) {
        return shell(ITEM_LIST_SHELL[itemType], `<section class="panel"><p>${label} not found.</p></section>`);
      }
    }
    const draftKey = itemType + ":" + (isNew ? "new" : id);
    const draft =
      state.adminItemDraft && state.adminItemDraft.key === draftKey ? state.adminItemDraft.values : null;
    const v = draft || item || { enabled: 1, quantity: 0, case_qty: 8 };
    const allCocktails = BartesianDB.listAllCocktails();
    const allRimmers = BartesianDB.listAllRimmersAdmin();
    const spirits = BartesianDB.listSpirits().map((s) => s.name);

    const systemRows = isNew
      ? ""
      : `<h2>System</h2>
         <div class="admin-item-grid">
           ${itemField(v, "id", "ID", {})}
           ${itemField(v, "created_at", "Created", {})}
           ${itemField(v, "updated_at", "Updated", {})}
         </div>
         <p class="hint">ID / timestamps are read-only (shown for reference; disabled inputs aren't saved).</p>`;

    // Make system inputs disabled after render via attribute in markup is simpler:
    const systemHtml = systemRows
      .replace('name="id"', 'name="id" disabled')
      .replace('name="created_at"', 'name="created_at" disabled')
      .replace('name="updated_at"', 'name="updated_at" disabled');

    let body = "";
    if (itemType === "cocktail") {
      const spiritVal = Array.isArray(v.spirits) ? v.spirits.join(", ") : v.spirits || v.spirits_csv?.split("|").join(", ") || "";
      const paired = new Set((v.rimmer_ids || []).map(Number));
      body = `
        <h2>Basics</h2>
        <div class="admin-item-grid">
          ${itemField(v, "name", "Name", { required: true })}
          ${itemField(v, "slug", "Slug (blank = from name)", {})}
          ${itemField({ spirits_text: spiritVal }, "spirits_text", "Spirits (comma-separated)", { list: "spirit-options" })}
          ${itemField(v, "glassware", "Glassware", {})}
          ${itemField(v, "garnish", "Garnish", {})}
          ${itemField(v, "pairs_with", "Pairs with", {})}
        </div>
        <datalist id="spirit-options">${spirits.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
        ${itemField(v, "description", "Description", { type: "textarea" })}
        ${itemField(v, "details", "Details", { type: "textarea", rows: 5 })}
        <h2>Images &amp; links</h2>
        <div class="admin-item-grid">
          ${itemField(v, "image", "Image", {})}
          ${itemField(v, "hero_image", "Hero image", {})}
          ${itemField(v, "marketing_image", "Marketing image", {})}
          ${itemField(v, "image_cut", "Image Cut", { type: "select", options: ["NA", "Left", "Right"] })}
          ${itemField(v, "bartesian_url", "Bartesian URL", {})}
          ${itemField(v, "help_url", "Help URL", {})}
        </div>
        <h2>Shopify / IDs</h2>
        <div class="admin-item-grid">
          ${itemField(v, "shopify_product_id", "Shopify product ID", {})}
          ${itemField(v, "shopify_variant_id", "Shopify variant ID", {})}
          ${itemField(v, "shopify_handle", "Shopify handle", {})}
          ${itemField(v, "shopify_sku", "Shopify SKU", {})}
          ${itemField(v, "gorgias_article_id", "Gorgias article ID", {})}
        </div>
        <h2>Structured data</h2>
        ${itemField(v, "nutrition_json", "Nutrition (JSON / text)", { type: "textarea" })}
        ${itemField(v, "alcohol_json", "Alcohol (JSON / text)", { type: "textarea" })}
        <h2>Inventory &amp; flags</h2>
        <div class="admin-item-grid">
          ${itemField(v, "quantity", "Quantity", { type: "number", min: 0 })}
          ${itemField(v, "capsule_barcode", "Capsule barcode", {})}
          ${itemField(v, "case_barcode", "Case barcode", {})}
          ${itemField(v, "case_qty", "Case qty", { type: "number", min: 1 })}
        </div>
        <div class="admin-item-checks">
          ${itemField(v, "seasonal", "Seasonal", { type: "checkbox" })}
          ${itemField(v, "favorite", "Favorite", { type: "checkbox" })}
          ${itemField(v, "restock", "Restock needed", { type: "checkbox" })}
          ${itemField(v, "enabled", "Enabled", { type: "checkbox" })}
        </div>
        <h2>Recommended rimmers</h2>
        <div class="check-list">
          ${allRimmers.map((r) => `<label class="check"><input type="checkbox" name="rimmer_ids" value="${r.id}" ${paired.has(Number(r.id)) ? "checked" : ""}/> ${esc(r.name)}</label>`).join("") || `<p class="muted">No rimmers yet.</p>`}
        </div>`;
    } else if (itemType === "rimmer") {
      const paired = new Set((v.cocktail_ids || []).map(Number));
      body = `
        <h2>Basics</h2>
        <div class="admin-item-grid">
          ${itemField(v, "name", "Name", { required: true })}
          ${itemField(v, "slug", "Slug (blank = from name)", {})}
          ${itemField(v, "kind", "Type (free text)", { list: "rimmer-kind-options" })}
          ${itemField(v, "pairs_with", "Pairs with", {})}
        </div>
        <datalist id="rimmer-kind-options"><option value="sugar"></option><option value="salt"></option></datalist>
        ${itemField(v, "description", "Description", { type: "textarea" })}
        <h2>Images &amp; links</h2>
        <div class="admin-item-grid">
          ${itemField(v, "image", "Image", {})}
          ${itemField(v, "nutrition_image", "Nutrition image", {})}
          ${itemField(v, "bartesian_url", "Bartesian URL", {})}
          ${itemField(v, "help_url", "Help URL", {})}
        </div>
        <h2>Shopify / IDs</h2>
        <div class="admin-item-grid">
          ${itemField(v, "shopify_product_id", "Shopify product ID", {})}
          ${itemField(v, "shopify_variant_id", "Shopify variant ID", {})}
          ${itemField(v, "shopify_handle", "Shopify handle", {})}
          ${itemField(v, "gorgias_article_id", "Gorgias article ID", {})}
        </div>
        <h2>Inventory &amp; flags</h2>
        <div class="admin-item-grid">
          ${itemField(v, "quantity", "Quantity", { type: "number", min: 0 })}
          ${itemField(v, "barcode", "Barcode", {})}
        </div>
        <div class="admin-item-checks">
          ${itemField(v, "favorite", "Favorite", { type: "checkbox" })}
          ${itemField(v, "restock", "Restock needed", { type: "checkbox" })}
          ${itemField(v, "enabled", "Enabled", { type: "checkbox" })}
        </div>
        <h2>Cocktail pairings</h2>
        <div class="check-list">
          ${allCocktails.map((c) => `<label class="check"><input type="checkbox" name="cocktail_ids" value="${c.id}" ${paired.has(Number(c.id)) ? "checked" : ""}/> ${esc(c.name)}</label>`).join("") || `<p class="muted">No cocktails yet.</p>`}
        </div>`;
    } else {
      const qtyById = new Map((v.items || []).map((i) => [Number(i.cocktail_id), i.qty]));
      body = `
        <h2>Basics</h2>
        <div class="admin-item-grid">
          ${itemField(v, "name", "Name", { required: true })}
          ${itemField(v, "slug", "Slug (blank = from name)", {})}
          ${itemField(v, "barcode", "Pack barcode", {})}
        </div>
        ${itemField(v, "notes", "Notes", { type: "textarea", rows: 5 })}
        <h2>Images &amp; links</h2>
        <div class="admin-item-grid">
          ${itemField(v, "image", "Image", {})}
          ${itemField(v, "nutrition_image", "Nutrition image", {})}
          ${itemField(v, "bartesian_url", "Bartesian URL", {})}
          ${itemField(v, "help_url", "Help URL", {})}
        </div>
        <h2>Shopify / IDs</h2>
        <div class="admin-item-grid">
          ${itemField(v, "shopify_product_id", "Shopify product ID", {})}
          ${itemField(v, "shopify_variant_id", "Shopify variant ID", {})}
          ${itemField(v, "shopify_handle", "Shopify handle", {})}
          ${itemField(v, "gorgias_article_id", "Gorgias article ID", {})}
        </div>
        <div class="admin-item-checks">
          ${itemField(v, "enabled", "Enabled", { type: "checkbox" })}
        </div>
        <h2>Pack items</h2>
        <p class="hint">Only cocktails in this pack are listed. Use +/− to change qty (Save to apply). Qty 0 on Save removes the cocktail from the pack.</p>
        ${(() => {
          const draftKey = itemType + ":" + (isNew ? "new" : id);
          if (state.packEditKey !== draftKey || !Array.isArray(state.packEditIds)) {
            state.packEditKey = draftKey;
            state.packEditIds = [...qtyById.entries()]
              .filter(([, q]) => Number(q) > 0)
              .map(([cid]) => Number(cid));
          }
          const shownIds = state.packEditIds;
          const shownSet = new Set(shownIds.map(Number));
          const rows = shownIds
            .map((cid) => allCocktails.find((c) => Number(c.id) === Number(cid)))
            .filter(Boolean)
            .map((c) => {
              const q = qtyById.has(Number(c.id)) ? Number(qtyById.get(Number(c.id))) || 0 : 0;
              const thumb = primaryImage(c);
              return `
            <div class="cocktail-row has-qty-open" data-pack-item-row="${c.id}">
              <span class="qty-controls" data-qty-controls>
                ${q > 0 ? `<button type="button" class="qty-step" data-pack-item-delta="-1" data-id="${c.id}" aria-label="Decrease">−</button>` : ""}
                <span class="qty-badge ${qtyBadgeClass(q, false)}" data-pack-item-qty aria-label="Quantity ${q}">${q}</span>
                <button type="button" class="qty-step" data-pack-item-delta="1" data-id="${c.id}" aria-label="Increase">+</button>
              </span>
              <div class="thumb ${thumb ? "" : "thumb-empty"}">
                ${thumb ? `<img src="${esc(thumb)}" alt="">` : ""}
              </div>
              <div class="row-body">
                <div class="row-title">${esc(c.name)}${c.enabled ? "" : ' <span class="pill">Disabled</span>'}</div>
                <input type="hidden" name="item_qty_${c.id}" value="${q}" data-pack-item-input />
              </div>
            </div>`;
            })
            .join("");
          const addOpts = allCocktails
            .filter((c) => !shownSet.has(Number(c.id)))
            .map(
              (c) =>
                `<option value="${c.id}">${esc(c.name)}${c.enabled ? "" : " (disabled)"}</option>`
            )
            .join("");
          return `
        <div class="list pack-items-edit">
          ${rows || `<p class="muted">No cocktails in this pack yet.</p>`}
        </div>
        <div class="pack-add-row">
          <select data-pack-add-select aria-label="Add cocktail">
            <option value="">Add cocktail…</option>
            ${addOpts}
          </select>
          <button type="button" data-pack-add-cocktail>Add</button>
        </div>`;
        })()}`;
    }

    return shell(ITEM_LIST_SHELL[itemType], `
      <section class="panel">
        <a class="back" href="${ITEM_LIST_HREF[itemType]}" data-go="${ITEM_LIST_HREF[itemType]}">← Admin ${label}s</a>
        <p class="section-label">Admin</p>
        <h1>${isNew ? "Add" : "Edit"} ${label}${isNew ? "" : ": " + esc(item.name)}</h1>
        <p class="lede">Every database field is included. Export from Settings to write changes back to <code>data/</code> for git.</p>
        <form class="admin-item-form" data-admin-item-form data-item-type="${itemType}" data-id="${isNew ? "" : id}">
          ${body}
          ${systemHtml}
          <div class="modal-actions">
            <a class="btn-link" href="${ITEM_LIST_HREF[itemType]}" data-go="${ITEM_LIST_HREF[itemType]}">Cancel</a>
            <button type="submit">${isNew ? "Add " + label : "Save " + label}</button>
          </div>
        </form>
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
        <p class="lede">Raters and “used by” names. Admins see the Admin menu (saved in the <code>${esc(ADMIN_COOKIE)}</code> cookie for ${esc(CURRENT_USER)}). Deleting a person clears their name from history (events stay) and removes their cocktail ratings.</p>
        <div class="list">
          ${people.map((p) => {
            const editing = Number(state.peopleEditId) === Number(p.id);
            if (editing) {
              return `
            <div class="action-row admin-row">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <div class="row-body">
                <form class="inline-form person-edit-form" data-person-edit-form data-id="${p.id}">
                  <input name="name" type="text" value="${esc(p.name)}" required autofocus />
                  <button type="submit">Save</button>
                  <button type="button" class="ghost" data-person-edit-cancel>Cancel</button>
                </form>
              </div>
            </div>`;
            }
            return `
            <div class="action-row admin-row">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <div class="row-body">
                <div class="row-title">${esc(p.name)}${p.is_admin ? ' <span class="pill">Admin</span>' : ""}</div>
              </div>
              <div class="row-actions">
                ${adminToggleBtn(`data-person-admin data-id="${p.id}" data-name="${esc(p.name)}"`, p.is_admin, "Admin ✓", "Make admin")}
                <button type="button" class="btn-edit small" data-person-edit="${p.id}">Edit</button>
                <button type="button" class="ghost danger small" data-person-delete="${p.id}" data-name="${esc(p.name)}">Delete</button>
              </div>
            </div>`;
          }).join("") || `<p class="empty">None yet.</p>`}
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
    const cloud = !!window.BARTESIAN_CLOUDFLARE;
    const adminDisplay = state.isAdmin
      ? `
        <h2>Admin display options</h2>
        <p class="hint">Only visible to admins. Saved in a cookie on this device.</p>
        <p><label class="check"><input type="checkbox" data-ui-pref="showBookTuneBtn" ${state.showBookTuneBtn ? "checked" : ""}/> Show Tune button in Book mode</label></p>
        <p><label class="check"><input type="checkbox" data-ui-pref="showAdminImageCut" ${state.showAdminImageCut ? "checked" : ""}/> Show Image Cut in Cocktails Admin page</label></p>`
      : "";
    const cloudBlock = cloud
      ? `
        <h2>Cloud session</h2>
        <p>Inventory, ratings, and catalog edits are stored in Cloudflare D1 and shared across devices after sign-in.</p>
        <button type="button" data-logout>Log out</button>
        <h2>Export backup</h2>
        <p>Downloads a zip of the current server-backed catalog for offline backup or git seeding.</p>
        <button type="button" data-export>Export data</button>
        <p class="hint" data-export-status></p>`
      : `
        <h2>Force refresh</h2>
        <p>For iPad / PWA: unregister the service worker, clear caches, and reload. Keeps your local inventory database.</p>
        <p class="muted">Current build: <code>${esc(APP_VERSION)}</code></p>
        <button type="button" data-force-refresh>Force refresh</button>
        <h2>Export for GitHub</h2>
        <p>Downloads <code>bartesian-exports.zip</code>. Copy it to <code>exports/bartesian-exports.zip</code>, then run <code>node scripts/import-data.js</code> (or the Import debug task). That updates <code>data/</code> + seed; on next load the app applies seed quantities into local IndexedDB. Commit when ready.</p>
        <p class="hint">A normal reload keeps your browser DB. After an import, Force refresh (or hard reload) so the new seed rev is picked up — inventory counts then sync from seed.</p>
        <button type="button" data-export>Export data</button>
        <p class="hint" data-export-status></p>
        <h2>Local database</h2>
        <p>Clear IndexedDB and re-seed from <code>js/seed-data.js</code>. History, Wishlist, ratings, and Restock flags are only restored if they were exported and re-imported first.</p>
        <button type="button" class="danger" data-reset>Reset local DB</button>`;
    return shell(
      "settings",
      `
      <section class="panel">
        <p class="section-label">Admin</p>
        <h1>Settings</h1>
        <p class="muted">Current build: <code>${esc(APP_VERSION)}</code>${cloud ? " · Cloudflare D1" : ""}</p>
        ${cloudBlock}
        ${adminDisplay}
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

  /**
   * Book Mode cocktail order follows the selected Sort (via listCocktails).
   * Name A–Z / Z–A sort by cocktail name only (no spirit grouping).
   * Spirit sort is spirit then name. Seasonal cocktails and refreshers are excluded.
   */
  function bookCocktailList() {
    return BartesianDB.listCocktails(listQuery()).filter(
      (c) => !c.seasonal && !/refresher/i.test(String(c.name || "") + " " + String(c.slug || ""))
    );
  }

  function bookMetaPipe(label, value) {
    if (value == null || value === "") return "";
    return `<div class="book-meta-row">
      <p class="book-meta-label">${esc(label)}</p>
      <span class="book-meta-bar" aria-hidden="true"></span>
      <p class="book-meta-value">${esc(value)}</p>
    </div>`;
  }

  function bookChipSection(label, raw) {
    if (!raw || !window.BartesianIcons) return "";
    const chips = BartesianIcons.chipList(raw);
    if (!chips) return "";
    return `<div class="book-meta-row book-meta-chips">
      <p class="book-meta-label">${esc(label)}</p>
      <span class="book-meta-bar" aria-hidden="true"></span>
      <div>${chips}</div>
    </div>`;
  }

  /** Baked hero preset for this device/orientation, if one exists in CSS. */
  function bakedBookTune() {
    return bakedBookTuneFor(bookDeviceInfo());
  }

  function bookTuneStyle(layout, imageLeft) {
    const t = layout || { x: 0, y: 0, scale: 1 };
    // Stored X shifts toward the center spine, so mirror it on right pages.
    // Page side (left/right) drives the mirror; image cut only flips the bitmap.
    const appliedX = imageLeft ? t.x : -t.x;
    return `--book-tune-x:${appliedX}%;--book-tune-y:${t.y}%;--book-tune-scale:${t.scale}`;
  }

  function renderBookTune(cocktail) {
    if (!state.bookTuneOpen || !state.bookTuneDraft) return "";
    const t = state.bookTuneDraft;
    const signed = (v) => (v > 0 ? "+" : "") + v + "%";
    const w = window.innerWidth || 0;
    const h = window.innerHeight || 0;
    const cut = t.imageCut || "NA";
    const cutOpts = ["NA", "Left", "Right"]
      .map(
        (opt) =>
          `<option value="${opt}" ${opt === cut ? "selected" : ""}>${opt}</option>`
      )
      .join("");
    const dragged = !!state.bookTunePanelPos;
    return `<div class="book-tune-panel${dragged ? " is-dragged" : ""}" data-book-tune-panel style="${bookTunePanelStyle()}">
      <div class="book-tune-head" data-book-tune-drag title="Drag to move">
        <span class="book-tune-drag-label"><span class="book-tune-drag-grip" aria-hidden="true">⋮⋮</span> Tune · ${esc((cocktail && cocktail.name) || "Cocktail")}</span>
        <button type="button" data-book-tune-close>Close</button>
      </div>
      <input class="book-tune-readout-field" type="text" readonly aria-label="Current tuning settings (selectable)"
        value="${esc(t.form)} · ${esc(t.orientation)} · Shift ${signed(t.x)} · Move Y ${signed(t.y)} · Size ${Math.round(t.scale * 100)}%${t.dirty ? " · unsaved" : ""}" />
      <p class="book-tune-viewport">${w}×${h} · Defaults to the global ${esc(t.form)}/${esc(t.orientation)} position until you Save.</p>
      <p class="book-tune-viewport"><strong>Move panel:</strong> touch and hold the header (⋮⋮ Tune …), then drag. On desktop, click and drag the header.</p>
      <p class="book-tune-viewport">Shift + moves toward the center on both sides (mirrored on right pages); − moves toward the outer edge. Image Cut flips the photo on the matching page side.</p>
      ${t.status ? `<p class="book-tune-viewport book-tune-status">${esc(t.status)}</p>` : ""}
      <div class="book-tune-row">
        <span class="book-tune-label">Move</span>
        <button type="button" data-book-tune="left" aria-label="Move image left">←</button>
        <button type="button" data-book-tune="right" aria-label="Move image right">→</button>
        <button type="button" data-book-tune="up" aria-label="Move image up">↑</button>
        <button type="button" data-book-tune="down" aria-label="Move image down">↓</button>
      </div>
      <div class="book-tune-row">
        <span class="book-tune-label">Size</span>
        <button type="button" data-book-tune="smaller" aria-label="Make image smaller">−</button>
        <button type="button" data-book-tune="bigger" aria-label="Make image bigger">+</button>
        <button type="button" class="book-tune-reset" data-book-tune="reset" title="Revert draft to the current global position">Reset</button>
      </div>
      <div class="book-tune-row">
        <span class="book-tune-label">Cut</span>
        <select class="book-tune-cut" data-book-tune-cut aria-label="Image cut side">${cutOpts}</select>
      </div>
      <div class="book-tune-row book-tune-save-row">
        <button type="button" class="book-tune-save" data-book-tune-save ${t.dirty ? "" : "disabled"}>Save</button>
        <button type="button" class="book-tune-save-global" data-book-tune-save-global title="Update the global default for this form factor and orientation">Save as global</button>
      </div>
    </div>`;
  }

  function renderBook(id) {
    const list = bookCocktailList();
    if (!list.length) {
      return `<div class="book-mode" data-book-root>
        <button type="button" class="book-menu-btn" data-book-menu-open style="right:0.75rem;left:auto" aria-label="Open menu" title="Menu"><span aria-hidden="true">☰</span></button>
        <div class="book-copy" style="padding:2rem">
          <p class="book-spirit-chapter">Book Mode</p>
          <h1 class="book-title">No cocktails</h1>
          <hr class="book-rule" />
          <p class="book-blurb">Nothing matches the current filters. Open the menu to adjust them, or exit Book Mode.</p>
        </div>
        ${state.bookMenuOpen ? renderBookMenu(null) : ""}
      </div>`;
    }

    let index = list.findIndex((c) => c.id === id);
    if (index < 0) index = 0;
    const c = list[index];
    const imageLeft = index % 2 === 0;
    const photoSrc = primaryImage(c);
    const layout = effectiveBookLayout(c);
    // Image Cut: flip horizontally only when the cut side matches the
    // side the photo sits on (left photo + Left cut, or right photo + Right
    // cut). NA, or a cut on the opposite side, displays normally.
    // Cut is read from book settings (draft while editing); not cocktail.txt.
    const imageCut = String(layout.imageCut || "NA");
    const flipPhoto =
      (imageLeft && imageCut === "Left") || (!imageLeft && imageCut === "Right");
    const spiritsText = (c.spirits || []).join(", ") || c.primary_spirit || "";

    // Always drive position from JS (per-cocktail / global / baked) so saved
    // book.json layouts override the CSS media-query bake.
    return `<div class="book-mode book-tuning" data-book-root data-book-id="${c.id}" data-book-index="${index}" style="${bookTuneStyle(layout, imageLeft)}">
      <button type="button" class="book-menu-btn" data-book-menu-open aria-label="Open menu" title="Menu"><span aria-hidden="true">☰</span></button>
      ${state.showBookTuneBtn ? `<button type="button" class="book-tune-btn" data-book-tune-open>Tune</button>` : ""}
      <article class="book-spread ${imageLeft ? "image-left" : "image-right"}" data-book-spread>
        <div class="book-photo ${photoSrc ? "" : "book-photo-empty"}">
          ${photoSrc ? `<img src="${esc(photoSrc)}" alt="" draggable="false" ${flipPhoto ? `class="book-flip"` : ""}>` : ""}
        </div>
        <div class="book-copy">
          <h1 class="book-title">${esc(c.name)}</h1>
          <hr class="book-rule" />
          <div class="book-meta">
            ${bookMetaPipe("Tasting Notes", c.description)}
            ${bookMetaPipe("Base Spirit", spiritsText)}
            ${bookMetaPipe("Recommended Glassware", c.glassware)}
            ${bookChipSection("Garnish", c.garnish)}
          </div>
        </div>
        <span class="book-page-num">${index + 1}</span>
      </article>
      <p class="book-hint">Swipe</p>
      ${renderBookTune(c)}
      ${state.bookMenuOpen ? renderBookMenu(c.id) : ""}
    </div>`;
  }

  /** Turn Apply blue only while the menu form differs from applied filters. */
  function syncBookApplyState(form) {
    if (!form) return;
    const applyBtn = form.querySelector("[data-book-apply]");
    if (!applyBtn) return;
    const fd = new FormData(form);
    const dirty =
      String(fd.get("search") || "") !== String(state.search || "") ||
      String(fd.get("spirit") || "") !== String(state.spirit || "") ||
      String(fd.get("sort") || "spirit") !== String(state.sort || "spirit") ||
      !!(form.available && form.available.checked) !== !!state.availableOnly ||
      !!(form.favorites && form.favorites.checked) !== !!state.favoritesOnly;
    applyBtn.classList.toggle("is-dirty", dirty);
  }

  function renderBookMenu(currentId) {
    const spirits = BartesianDB.listSpirits();
    const exitHref = currentId ? `#/cocktail/${currentId}` : "#/";
    return `<div class="book-modal-backdrop" data-book-menu>
      <div class="book-modal" role="dialog" aria-modal="true" aria-label="Book menu">
        <button type="button" class="book-modal-close" data-book-menu-close aria-label="Close menu" title="Close"><span aria-hidden="true">×</span></button>
        <h2>Menu</h2>
        <form class="book-modal-form" data-book-filters>
          <label class="field">Search
            <input type="search" name="search" value="${esc(state.search)}" placeholder="Search" />
          </label>
          <label class="field">Spirit
            <select name="spirit">
              <option value="">All spirits</option>
              ${spirits
                .map(
                  (s) =>
                    `<option value="${esc(s.name)}" ${state.spirit === s.name ? "selected" : ""}>${esc(s.name)}</option>`
                )
                .join("")}
            </select>
          </label>
          <label class="field">Sort
            <select name="sort">
              <option value="spirit" ${state.sort === "spirit" ? "selected" : ""}>Spirit</option>
              <option value="name" ${state.sort === "name" ? "selected" : ""}>Name A–Z</option>
              <option value="name-desc" ${state.sort === "name-desc" ? "selected" : ""}>Name Z–A</option>
              <option value="quantity" ${state.sort === "quantity" ? "selected" : ""}>Quantity ↓</option>
              <option value="quantity-asc" ${state.sort === "quantity-asc" ? "selected" : ""}>Quantity ↑</option>
              <option value="rating" ${state.sort === "rating" ? "selected" : ""}>Rating</option>
              <option value="seasonal" ${state.sort === "seasonal" ? "selected" : ""}>Seasonal</option>
            </select>
          </label>
          <div class="book-modal-checks">
            <label><input type="checkbox" name="available" ${state.availableOnly ? "checked" : ""}/> In stock</label>
            <label><input type="checkbox" name="favorites" ${state.favoritesOnly ? "checked" : ""}/> Favorites</label>
          </div>
          <div class="book-modal-actions">
            <button type="submit" data-book-apply>Apply</button>
            <button type="button" class="ghost" data-book-exit data-go="${exitHref}">Exit book mode</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  function bookGoRelative(delta) {
    const list = bookCocktailList();
    if (!list.length) return;
    const route = parseHash();
    let index = list.findIndex((c) => c.id === route.id);
    if (index < 0) index = 0;
    const next = Math.max(0, Math.min(list.length - 1, index + delta));
    if (list[next]) {
      state.bookMenuOpen = false;
      // Unsaved tune edits are discarded when changing cocktails/pages.
      const stayOpen = state.bookTuneOpen;
      discardBookTuneDraft();
      if (stayOpen) beginBookTuneDraft(list[next].id);
      else endBookTuneSession();
      go("#/book/" + list[next].id);
    }
  }

  function setBookActiveClass(on) {
    document.documentElement.classList.toggle("book-active", !!on);
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
    if (route.view !== "detail") state.useModal = null;
    if (route.view !== "random") state.randomModal = null;
    if (route.view !== "scan" && route.view !== "admin-barcodes") state.scanMatchModal = null;
    if (route.view !== "admin-item-edit" || route.itemType !== "pack") {
      state.packEditIds = null;
      state.packEditKey = "";
    }
    if (route.view !== "admin-people" && route.view !== "people") {
      state.peopleEditId = null;
    }
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
    if (route.view === "book") {
      setBookActiveClass(true);
      // If the cocktail changed outside bookGoRelative, drop unsaved edits.
      if (
        state.bookTuneDraft &&
        route.id != null &&
        !Number.isNaN(route.id) &&
        state.bookTuneDraft.cocktailId !== route.id
      ) {
        const stayOpen = state.bookTuneOpen;
        discardBookTuneDraft();
        if (stayOpen) beginBookTuneDraft(route.id);
        else endBookTuneSession();
      }
      // Resolve missing id to first page in the filtered book order.
      if (route.id == null || Number.isNaN(route.id)) {
        const list = bookCocktailList();
        const first = list[0];
        root.innerHTML = renderBook(first ? first.id : null);
        if (first && (location.hash === "#/book" || location.hash === "#/book/")) {
          history.replaceState(null, "", "#/book/" + first.id);
          currentRouteKey = routeKeyFor({ view: "book", id: first.id });
        }
      } else {
        root.innerHTML = renderBook(route.id);
      }
    } else {
      setBookActiveClass(false);
      state.bookMenuOpen = false;
      // Leaving Book Mode ends the Tune session (draft + panel position).
      if (state.bookTuneDraft || state.bookTuneOpen || state.bookTunePanelPos) {
        endBookTuneSession();
      }
      if (route.view === "detail") root.innerHTML = renderDetail(route.id);
      else if (route.view === "rimmers") root.innerHTML = renderRimmers();
      else if (route.view === "rimmer-detail") root.innerHTML = renderRimmerDetail(route.id);
      else if (route.view === "packs") root.innerHTML = renderPacks();
      else if (route.view === "pack-detail") root.innerHTML = renderPackDetail(route.id);
      else if (route.view === "scan") root.innerHTML = renderScan();
      else if (route.view === "item-history") root.innerHTML = renderItemHistory(route.itemType, route.id);
      else if (route.view === "wishlist") root.innerHTML = renderWishlist();
      else if (route.view === "restock") root.innerHTML = renderRestock();
      else if (route.view === "admin-barcodes") root.innerHTML = renderAdminBarcodes();
      else if (route.view === "admin-cocktails") root.innerHTML = renderAdminCocktails();
      else if (route.view === "admin-rimmers") root.innerHTML = renderAdminRimmers();
      else if (route.view === "admin-packs") root.innerHTML = renderAdminPacks();
      else if (route.view === "admin-item-edit") root.innerHTML = renderAdminItemEdit(route.itemType, route.id);
      else if (route.view === "admin-people" || route.view === "people") root.innerHTML = renderPeople();
      else if (route.view === "random") root.innerHTML = renderRandom();
      else if (route.view === "settings") root.innerHTML = renderSettings();
      else if (route.view === "disclaimer") root.innerHTML = renderDisclaimer();
      else root.innerHTML = renderList();
    }
    state.flash = "";
    if (isFirstRender || isRouteChange) {
      // New screens always start at the top; returning to a screen restores
      // its previous scroll spot (so Back to the list keeps your place).
      const saved = routeScrollPositions.get(nextRouteKey);
      window.scrollTo(0, route.view === "book" ? 0 : saved != null ? saved : 0);
    }
    scheduleAlphaIndexSync();
    syncBackToTop();
  }

  async function onClick(e) {
    if (e.target.closest("[data-book-menu-open]")) {
      e.preventDefault();
      state.bookMenuOpen = true;
      render();
      return;
    }
    if (e.target.closest("[data-book-menu-close]")) {
      e.preventDefault();
      state.bookMenuOpen = false;
      render();
      return;
    }
    if (e.target.closest("[data-book-tune-open]")) {
      e.preventDefault();
      const rootEl = e.target.closest("[data-book-root]");
      const cocktailId = rootEl ? Number(rootEl.getAttribute("data-book-id")) : 0;
      if (cocktailId) beginBookTuneDraft(cocktailId);
      state.bookTuneOpen = true;
      render();
      return;
    }
    if (e.target.closest("[data-book-tune-close]")) {
      e.preventDefault();
      // Closing without Save discards the draft and panel position.
      endBookTuneSession();
      render();
      return;
    }
    if (e.target.closest("[data-book-tune-save]")) {
      e.preventDefault();
      await saveBookTuneCocktail();
      return;
    }
    if (e.target.closest("[data-book-tune-save-global]")) {
      e.preventDefault();
      await saveBookTuneGlobal();
      return;
    }
    const tuneBtn = e.target.closest("[data-book-tune]");
    if (tuneBtn) {
      e.preventDefault();
      adjustBookTune(tuneBtn.getAttribute("data-book-tune"));
      return;
    }
    if (e.target.closest("[data-book-exit]")) {
      state.bookMenuOpen = false;
      endBookTuneSession();
      setBookActiveClass(false);
      // Let data-go handle navigation when present.
    }
    if (e.target.closest("[data-book-menu]") && !e.target.closest(".book-modal")) {
      e.preventDefault();
      state.bookMenuOpen = false;
      render();
      return;
    }
    // Book Mode: ignore any other in-page navigation except menu/exit.
    if (document.documentElement.classList.contains("book-active")) {
      const goEl = e.target.closest("[data-go]");
      if (goEl && !e.target.closest("[data-book-exit]")) {
        e.preventDefault();
        return;
      }
    }
    if (e.target.closest("[data-back-to-top]")) {
      // Instant jump (no smooth scrolling)
      window.scrollTo(0, 0);
      syncBackToTop();
      return;
    }

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

    if (e.target.closest("[data-use-modal-close]")) {
      state.useModal = null;
      render();
      return;
    }
    if (
      state.useModal &&
      e.target.hasAttribute &&
      e.target.hasAttribute("data-use-modal-backdrop")
    ) {
      state.useModal = null;
      render();
      return;
    }

    if (e.target.closest("[data-random-modal-close]")) {
      state.randomModal = null;
      render();
      return;
    }
    if (
      state.randomModal &&
      e.target.hasAttribute &&
      e.target.hasAttribute("data-random-modal-backdrop")
    ) {
      state.randomModal = null;
      render();
      return;
    }
    if (e.target.closest("[data-random-try-again]")) {
      const form = root.querySelector("[data-random-form]");
      if (form) {
        const fd = new FormData(form);
        state.randomSpirit = String(fd.get("spirit") || "");
        state.randomFavoritesOnly = form.favorites ? form.favorites.checked : false;
      }
      const pick = BartesianDB.pickRandom({
        spirit: state.randomSpirit,
        favoritesOnly: state.randomFavoritesOnly,
        availableOnly: true,
      });
      state.randomModal = pick || { empty: true };
      render();
      return;
    }

    if (state.scanMatchModal && e.target.closest("[data-scan-match-backdrop]")) {
      state.scanMatchModal = null;
      render();
      return;
    }

    const personOption = e.target.closest("[data-person-combo-option]");
    if (personOption) {
      e.preventDefault();
      const combo = personOption.closest("[data-person-combo]");
      const input = combo && combo.querySelector("[data-person-combo-input]");
      if (input) {
        input.value = String(personOption.textContent || "").trim();
        input.focus();
      }
      closeAllPersonCombos();
      return;
    }
    const personToggle = e.target.closest("[data-person-combo-toggle]");
    if (personToggle) {
      e.preventDefault();
      const combo = personToggle.closest("[data-person-combo]");
      if (!combo) return;
      if (combo.classList.contains("is-open")) closeAllPersonCombos();
      else openPersonCombo(combo);
      return;
    }
    if (e.target.closest("[data-person-combo-input]")) {
      const combo = e.target.closest("[data-person-combo]");
      openPersonCombo(combo);
      return;
    }
    if (!e.target.closest("[data-person-combo]")) {
      closeAllPersonCombos();
    }

    if (e.target.closest("[data-search-clear]")) {
      state.search = "";
      saveListPrefs();
      render();
      return;
    }
    if (e.target.closest("[data-pack-search-clear]")) {
      state.packSearch = "";
      render();
      return;
    }

    const packItemDelta = e.target.closest("[data-pack-item-delta]");
    if (packItemDelta) {
      e.preventDefault();
      const row = packItemDelta.closest("[data-pack-item-row]");
      if (!row) return;
      const delta = Number(packItemDelta.getAttribute("data-pack-item-delta")) || 0;
      const input = row.querySelector("[data-pack-item-input]");
      const badge = row.querySelector("[data-pack-item-qty]");
      const controls = row.querySelector("[data-qty-controls]");
      let q = Math.max(0, (Number(input && input.value) || 0) + delta);
      if (input) input.value = String(q);
      if (badge) {
        badge.textContent = String(q);
        badge.setAttribute("aria-label", "Quantity " + q);
        badge.className = "qty-badge " + qtyBadgeClass(q, false);
      }
      if (controls) {
        let minus = controls.querySelector('[data-pack-item-delta="-1"]');
        if (q > 0 && !minus) {
          minus = document.createElement("button");
          minus.type = "button";
          minus.className = "qty-step";
          minus.setAttribute("data-pack-item-delta", "-1");
          minus.setAttribute("data-id", packItemDelta.getAttribute("data-id") || "");
          minus.setAttribute("aria-label", "Decrease");
          minus.textContent = "−";
          controls.insertBefore(minus, controls.firstChild);
        } else if (q === 0 && minus) {
          minus.remove();
        }
      }
      return;
    }

    const packAddBtn = e.target.closest("[data-pack-add-cocktail]");
    if (packAddBtn) {
      e.preventDefault();
      const form = packAddBtn.closest("[data-admin-item-form]");
      if (!form || form.getAttribute("data-item-type") !== "pack") return;
      const select = form.querySelector("[data-pack-add-select]");
      const newId = Number(select && select.value);
      if (!newId) {
        state.flash = "Choose a cocktail to add.";
        render();
        return;
      }
      const fd = new FormData(form);
      const text = (n) => String(fd.get(n) || "");
      const on = (n) => fd.get(n) != null;
      const items = [];
      form.querySelectorAll("[data-pack-item-input]").forEach((input) => {
        const cid = Number(String(input.name || "").replace(/^item_qty_/, ""));
        if (!cid) return;
        items.push({ cocktail_id: cid, qty: Number(input.value) || 0 });
      });
      if (!items.some((i) => Number(i.cocktail_id) === newId)) {
        items.push({ cocktail_id: newId, qty: 0 });
      }
      const idAttr = form.getAttribute("data-id");
      const editId = idAttr ? Number(idAttr) : null;
      const draftKey = "pack:" + (editId == null ? "new" : editId);
      state.adminItemDraft = {
        key: draftKey,
        values: {
          name: text("name"),
          slug: text("slug"),
          barcode: text("barcode"),
          notes: text("notes"),
          image: text("image"),
          nutrition_image: text("nutrition_image"),
          bartesian_url: text("bartesian_url"),
          help_url: text("help_url"),
          shopify_product_id: text("shopify_product_id"),
          shopify_variant_id: text("shopify_variant_id"),
          shopify_handle: text("shopify_handle"),
          gorgias_article_id: text("gorgias_article_id"),
          enabled: on("enabled"),
          items,
        },
      };
      if (!Array.isArray(state.packEditIds)) state.packEditIds = [];
      if (!state.packEditIds.some((id) => Number(id) === newId)) {
        state.packEditIds = state.packEditIds.concat([newId]);
      }
      state.packEditKey = draftKey;
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
      const name = useBtn.getAttribute("data-name") || "";
      const c = BartesianDB.getCocktail(id);
      state.useModal = { id, name: name || (c && c.name) || "Cocktail" };
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

    const personEditBtn = e.target.closest("[data-person-edit]");
    if (personEditBtn) {
      state.peopleEditId = Number(personEditBtn.getAttribute("data-person-edit"));
      render();
      return;
    }
    if (e.target.closest("[data-person-edit-cancel]")) {
      state.peopleEditId = null;
      render();
      return;
    }
    const personDeleteBtn = e.target.closest("[data-person-delete]");
    if (personDeleteBtn) {
      const id = Number(personDeleteBtn.getAttribute("data-person-delete"));
      const name = personDeleteBtn.getAttribute("data-name") || "this person";
      if (name.toLowerCase() === CURRENT_USER.toLowerCase()) {
        if (
          !confirm(
            'Delete yourself ("' +
              name +
              '")? History keeps the events with no name; your ratings are removed. The Admin menu may disappear.'
          )
        ) {
          return;
        }
      } else if (
        !confirm(
          'Delete "' +
            name +
            '"? History keeps their events with no name; their cocktail ratings are removed.'
        )
      ) {
        return;
      }
      try {
        await BartesianDB.deletePerson(id);
        if (Number(state.peopleEditId) === id) state.peopleEditId = null;
        syncAdminFromDb();
        state.flash = "Deleted " + name + ".";
        render();
      } catch (err) {
        state.flash = "Delete failed: " + err.message;
        render();
      }
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

    const scanPick = e.target.closest("[data-scan-pick]");
    if (scanPick) {
      const [type, idStr] = String(scanPick.getAttribute("data-scan-pick") || "").split(":");
      state.scanDelta = -1;
      state.scanPreview = BartesianBarcodes.resolveItem(BartesianDB, type, Number(idStr), {
        capsuleDelta: state.scanDelta,
        rimmerDelta: state.scanDelta,
      });
      render();
      return;
    }

    const scanDeltaBtn = e.target.closest("[data-scan-delta]");
    if (scanDeltaBtn) {
      state.scanDelta = Number(scanDeltaBtn.getAttribute("data-scan-delta"));
      if (state.scanPreview && state.scanPreview.source === "name" && state.scanPreview.itemType) {
        state.scanPreview = BartesianBarcodes.resolveItem(
          BartesianDB,
          state.scanPreview.itemType,
          state.scanPreview.itemId,
          {
            capsuleDelta: state.scanDelta,
            rimmerDelta: state.scanDelta,
          }
        );
      } else if (state.scanPreview && state.scanPreview.code) {
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

    if (e.target.closest("[data-logout]")) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch (_) {
        /* still redirect to login */
      }
      location.replace("/login");
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
        const snapshot = BartesianDB.exportSnapshot();
        // Each device only tests one form factor — export only that form's
        // book layouts so import deep-merges without wiping other devices.
        const device = bookDeviceInfo();
        snapshot.book = BartesianDB.exportBook(device.form);
        await BartesianExport.exportAll(snapshot);
        if (status) {
          status.textContent =
            "Downloaded bartesian-exports.zip — check your Downloads folder, then copy it to exports/ and run the import. Book layouts included for " +
            device.form +
            " only.";
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
    const bookForm = e.target.closest("[data-book-filters]");
    if (bookForm) {
      e.preventDefault();
      const fd = new FormData(bookForm);
      state.search = String(fd.get("search") || "");
      state.spirit = String(fd.get("spirit") || "");
      state.sort = String(fd.get("sort") || "spirit");
      state.availableOnly = !!(bookForm.available && bookForm.available.checked);
      state.favoritesOnly = !!(bookForm.favorites && bookForm.favorites.checked);
      saveListPrefs();
      state.bookMenuOpen = false;
      const list = bookCocktailList();
      const route = parseHash();
      const still = list.find((c) => c.id === route.id);
      const nextHref = still
        ? "#/book/" + still.id
        : list[0]
          ? "#/book/" + list[0].id
          : "#/book";
      // Same-hash Apply must still close the menu (hashchange won't fire).
      if (location.hash === nextHref) render();
      else go(nextHref);
      return;
    }

    const listForm = e.target.closest("[data-list-filters]");
    if (listForm) {
      e.preventDefault();
      const fd = new FormData(listForm);
      state.search = String(fd.get("search") || "");
      state.spirit = String(fd.get("spirit") || "");
      state.sort = String(fd.get("sort") || "spirit");
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

    const scanNameForm = e.target.closest("[data-scan-name-search]");
    if (scanNameForm) {
      e.preventDefault();
      state.scanNameQuery = String(new FormData(scanNameForm).get("query") || "");
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
      state.randomModal = pick || { empty: true };
      render();
      return;
    }

    const useOneForm = e.target.closest("[data-use-one-form]");
    if (useOneForm) {
      e.preventDefault();
      const id = Number(useOneForm.getAttribute("data-id"));
      const fd = new FormData(useOneForm);
      const personName = String(fd.get("person_name") || "").trim();
      let personId = null;
      if (personName) {
        const person = await BartesianDB.addPerson(personName);
        personId = person ? person.id : null;
      }
      await BartesianDB.adjustQuantity(id, -1, "use_capsule", "", { personId });
      state.useModal = null;
      state.flash = personName ? "Used 1 · " + personName : "Used 1";
      render();
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

    const itemFormEl = e.target.closest("[data-admin-item-form]");
    if (itemFormEl) {
      e.preventDefault();
      const itemType = itemFormEl.getAttribute("data-item-type");
      const idAttr = itemFormEl.getAttribute("data-id");
      const editId = idAttr ? Number(idAttr) : null;
      const fd = new FormData(itemFormEl);
      const text = (n) => String(fd.get(n) || "");
      const num = (n) => Number(fd.get(n)) || 0;
      const on = (n) => fd.get(n) != null;
      let payload;
      if (itemType === "cocktail") {
        payload = {
          name: text("name"), slug: text("slug"),
          spirits: text("spirits_text").split(",").map((s) => s.trim()).filter(Boolean),
          glassware: text("glassware"), garnish: text("garnish"), pairs_with: text("pairs_with"),
          description: text("description"), details: text("details"),
          image: text("image"), hero_image: text("hero_image"), marketing_image: text("marketing_image"),
          image_cut: text("image_cut") || "NA",
          bartesian_url: text("bartesian_url"), help_url: text("help_url"),
          shopify_product_id: text("shopify_product_id"), shopify_variant_id: text("shopify_variant_id"),
          shopify_handle: text("shopify_handle"), shopify_sku: text("shopify_sku"),
          gorgias_article_id: text("gorgias_article_id"),
          nutrition_json: text("nutrition_json"), alcohol_json: text("alcohol_json"),
          quantity: num("quantity"), capsule_barcode: text("capsule_barcode"),
          case_barcode: text("case_barcode"), case_qty: Number(fd.get("case_qty")) || 8,
          seasonal: on("seasonal"), favorite: on("favorite"), restock: on("restock"), enabled: on("enabled"),
          rimmer_ids: fd.getAll("rimmer_ids").map(Number),
        };
      } else if (itemType === "rimmer") {
        payload = {
          name: text("name"), slug: text("slug"), kind: text("kind"), pairs_with: text("pairs_with"),
          description: text("description"),
          image: text("image"), nutrition_image: text("nutrition_image"),
          bartesian_url: text("bartesian_url"), help_url: text("help_url"),
          shopify_product_id: text("shopify_product_id"), shopify_variant_id: text("shopify_variant_id"),
          shopify_handle: text("shopify_handle"), gorgias_article_id: text("gorgias_article_id"),
          quantity: num("quantity"), barcode: text("barcode"),
          favorite: on("favorite"), restock: on("restock"), enabled: on("enabled"),
          cocktail_ids: fd.getAll("cocktail_ids").map(Number),
        };
      } else {
        const items = [];
        for (const c of BartesianDB.listAllCocktails()) {
          const qty = Number(fd.get("item_qty_" + c.id)) || 0;
          if (qty > 0) items.push({ cocktail_id: c.id, qty });
        }
        payload = {
          name: text("name"), slug: text("slug"), barcode: text("barcode"), notes: text("notes"),
          image: text("image"), nutrition_image: text("nutrition_image"),
          bartesian_url: text("bartesian_url"), help_url: text("help_url"),
          shopify_product_id: text("shopify_product_id"), shopify_variant_id: text("shopify_variant_id"),
          shopify_handle: text("shopify_handle"), gorgias_article_id: text("gorgias_article_id"),
          enabled: on("enabled"),
          items,
        };
      }
      try {
        const saved =
          itemType === "cocktail" ? await BartesianDB.saveCocktail(editId, payload)
          : itemType === "rimmer" ? await BartesianDB.saveRimmer(editId, payload)
          : await BartesianDB.savePack(editId, payload);
        state.adminItemDraft = null;
        state.packEditIds = null;
        state.packEditKey = "";
        state.flash =
          (editId ? "Saved " : "Added ") + (saved && saved.name ? saved.name : ITEM_LABELS[itemType]) +
          ". Export from Settings to write it back to data/ for git.";
        go(ITEM_LIST_HREF[itemType]);
        render();
      } catch (err) {
        // Keep the entered values so a validation error doesn't wipe the form
        state.adminItemDraft = {
          key: itemType + ":" + (editId == null ? "new" : editId),
          values: {
            ...payload,
            spirits_text: Array.isArray(payload.spirits) ? payload.spirits.join(", ") : payload.spirits,
          },
        };
        state.flash = "Save failed: " + err.message;
        render();
      }
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

    const personEditForm = e.target.closest("[data-person-edit-form]");
    if (personEditForm) {
      e.preventDefault();
      const id = Number(personEditForm.getAttribute("data-id"));
      const name = String(new FormData(personEditForm).get("name") || "").trim();
      try {
        await BartesianDB.renamePerson(id, name);
        state.peopleEditId = null;
        state.flash = "Updated " + name + ".";
        syncAdminFromDb();
        render();
      } catch (err) {
        state.flash = "Rename failed: " + err.message;
        render();
      }
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

    if (e.target.matches("[data-person-combo-input]")) {
      const combo = e.target.closest("[data-person-combo]");
      openPersonCombo(combo);
      return;
    }

    const bookForm = e.target.closest("[data-book-filters]");
    if (bookForm) {
      syncBookApplyState(bookForm);
      return;
    }

    const listForm = e.target.closest("[data-list-filters]");
    if (listForm && e.target.name === "search") {
      state.search = e.target.value;
      saveListPrefs();
      const cocktails = BartesianDB.listCocktails(listQuery());
      const count = root.querySelector(".count");
      if (count) {
        const wrap = document.createElement("div");
        wrap.innerHTML = cocktailListCountHtml(cocktails);
        const next = wrap.firstElementChild;
        if (next) count.replaceWith(next);
      }
      const clearBtn = listForm.querySelector("[data-search-clear]");
      const searchWrap = listForm.querySelector(".toolbar-search-wrap");
      if (state.search && !clearBtn && searchWrap) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-search-clear";
        btn.setAttribute("data-search-clear", "");
        btn.setAttribute("aria-label", "Clear search");
        btn.textContent = "×";
        searchWrap.appendChild(btn);
      } else if (!state.search && clearBtn) {
        clearBtn.remove();
      }
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

    const packForm = e.target.closest("[data-pack-filters]");
    if (packForm && e.target.name === "search") {
      state.packSearch = e.target.value;
      render();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm && e.target.name === "search") {
      state.rimmerSearch = e.target.value;
      render();
    }
  }

  function onChange(e) {
    const bookCut = e.target.closest("[data-book-tune-cut]");
    if (bookCut && state.bookTuneDraft) {
      state.bookTuneDraft = {
        ...state.bookTuneDraft,
        imageCut: ["Left", "Right"].includes(bookCut.value) ? bookCut.value : "NA",
        dirty: true,
        status: "",
      };
      render();
      return;
    }

    const bookForm = e.target.closest("[data-book-filters]");
    if (bookForm) {
      syncBookApplyState(bookForm);
      return;
    }

    const uiPref = e.target.closest("[data-ui-pref]");
    if (uiPref) {
      const key = uiPref.getAttribute("data-ui-pref");
      if (key === "showBookTuneBtn" || key === "showAdminImageCut") {
        state[key] = !!uiPref.checked;
        saveUiPrefs();
      }
      return;
    }

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

    const imageCutSelect = e.target.closest("[data-admin-cocktail-image-cut]");
    if (imageCutSelect) {
      BartesianDB.setCocktailImageCut(
        Number(imageCutSelect.getAttribute("data-id")),
        imageCutSelect.value
      ).catch((err) => {
        state.flash = err.message;
        render();
      });
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
      return;
    }
    if (!document.documentElement.classList.contains("book-active")) return;
    if (state.bookMenuOpen) {
      if (e.key === "Escape") {
        state.bookMenuOpen = false;
        render();
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      bookGoRelative(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      bookGoRelative(-1);
    }
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!document.documentElement.classList.contains("book-active")) return;
      if (!state.bookTuneOpen) return;
      const handle = e.target.closest("[data-book-tune-drag]");
      if (!handle) return;
      // Don't start a drag from the Close button.
      if (e.target.closest("[data-book-tune-close]")) return;
      const panel = handle.closest("[data-book-tune-panel]");
      const rootEl = panel && panel.closest("[data-book-root]");
      if (!panel || !rootEl) return;
      e.preventDefault();
      const rootRect = rootEl.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      // Convert current on-screen position into root-local coordinates.
      const origLeft = panelRect.left - rootRect.left;
      const origTop = panelRect.top - rootRect.top;
      bookTuneDrag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origLeft,
        origTop,
        panelW: panelRect.width,
        panelH: panelRect.height,
        root: rootEl,
      };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      panel.classList.add("is-dragging");
      // Cancel any pending page-swipe gesture.
      bookTouchActive = false;
    },
    { passive: false }
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!bookTuneDrag || e.pointerId !== bookTuneDrag.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - bookTuneDrag.startX;
      const dy = e.clientY - bookTuneDrag.startY;
      const next = clampBookTunePanelPos(
        bookTuneDrag.root,
        bookTuneDrag.origLeft + dx,
        bookTuneDrag.origTop + dy,
        bookTuneDrag.panelW,
        bookTuneDrag.panelH
      );
      state.bookTunePanelPos = next;
      const panel = document.querySelector("[data-book-tune-panel]");
      if (panel) {
        panel.classList.add("is-dragged");
        panel.style.left = next.left + "px";
        panel.style.top = next.top + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.transform = "none";
      }
    },
    { passive: false }
  );
  function endBookTuneDrag(e) {
    if (!bookTuneDrag) return;
    if (e && e.pointerId != null && e.pointerId !== bookTuneDrag.pointerId) return;
    const panel = document.querySelector("[data-book-tune-panel]");
    if (panel) panel.classList.remove("is-dragging");
    bookTuneDrag = null;
  }
  document.addEventListener("pointerup", endBookTuneDrag);
  document.addEventListener("pointercancel", endBookTuneDrag);

  document.addEventListener(
    "touchstart",
    (e) => {
      if (!document.documentElement.classList.contains("book-active")) return;
      if (state.bookMenuOpen) return;
      if (!e.touches || !e.touches[0]) return;
      if (e.target.closest(".book-modal, .book-menu-btn, .book-tune-panel, .book-tune-btn")) return;
      bookTouchActive = true;
      bookTouchStartX = e.touches[0].clientX;
      bookTouchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchend",
    (e) => {
      if (!bookTouchActive) return;
      bookTouchActive = false;
      if (!document.documentElement.classList.contains("book-active") || state.bookMenuOpen) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - bookTouchStartX;
      const dy = t.clientY - bookTouchStartY;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      // Swipe left → next page; swipe right → previous (book metaphor).
      bookGoRelative(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
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
  window.addEventListener("scroll", () => {
    scheduleAlphaIndexSync();
    syncBackToTop();
  }, { passive: true });
  window.addEventListener("resize", scheduleAlphaIndexSync, { passive: true });
  // Keep the tune panel's viewport readout current after rotation.
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (document.documentElement.classList.contains("book-active")) render();
    }, 250);
  });

  boot();
})();
