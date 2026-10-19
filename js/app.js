(function () {
  /** Keep in sync with sw.js CACHE_VERSION */
  const APP_VERSION = "bartesian-v15";

  const root = document.getElementById("app");
  let cameraScanner = null;
  let cameraTarget = null; // "scan" | "admin" | null

  const state = {
    search: "",
    sort: "name",
    spirit: "",
    favoritesOnly: false,
    availableOnly: false,
    seasonalOnly: false,
    rimmerSearch: "",
    rimmerKind: "",
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
  };

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
    if (parts[0] === "scan") return { view: "scan" };
    if (parts[0] === "random") return { view: "random" };
    if (parts[0] === "people") return { view: "people" };
    if (parts[0] === "settings") return { view: "settings" };
    if (parts[0] === "admin" && parts[1] === "barcodes") return { view: "admin-barcodes" };
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

  function shell(active, body) {
    const nav = [
      ["list", "#/", "Cocktails"],
      ["rimmers", "#/rimmers", "Rimmers"],
      ["scan", "#/scan", "Scan"],
      ["random", "#/random", "Random"],
      ["people", "#/people", "People"],
      ["admin-barcodes", "#/admin/barcodes", "Barcodes"],
      ["settings", "#/settings", "Settings"],
    ];
    return `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-row">
            <a class="brand" href="#/" data-go="#/">Bartesian</a>
            <p class="tagline">Private inventory</p>
          </div>
          <nav class="topnav" aria-label="Primary">
            ${nav
              .map(
                ([key, href, label]) =>
                  `<a class="topnav-link ${active === key ? "on" : ""}" href="${href}" data-go="${href}">${label}</a>`
              )
              .join("")}
          </nav>
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

  function renderList() {
    const cocktails = BartesianDB.listCocktails({
      search: state.search,
      sort: state.sort,
      spirit: state.spirit,
      favoritesOnly: state.favoritesOnly,
      availableOnly: state.availableOnly,
      seasonalOnly: state.seasonalOnly,
    });
    const spirits = BartesianDB.listSpirits();

    const rows = cocktails
      .map((c) => {
        const spiritsText = (c.spirits_csv || "").split("|").filter(Boolean).join(", ");
        return `
          <a class="cocktail-row" href="#/cocktail/${c.id}" data-go="#/cocktail/${c.id}">
            <div class="thumb ${primaryImage(c) ? "" : "thumb-empty"}">
              ${primaryImage(c) ? `<img src="${esc(primaryImage(c))}" alt="">` : ""}
            </div>
            <div class="row-body">
              <div class="row-title">${esc(c.name)}${c.favorite ? " ★" : ""}${c.seasonal ? ' <span class="pill">Seasonal</span>' : ""}</div>
              <div class="row-meta">${esc(spiritsText || "—")} · ${starsLabel(c.avg_rating)}</div>
            </div>
            <div class="row-qty">${c.quantity}</div>
          </a>
        `;
      })
      .join("");

    return shell(
      "list",
      `
      <section class="panel">
        <p class="section-label">Menu</p>
        <h1>Cocktails</h1>
        <form class="toolbar" data-list-filters>
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
          </select>
          <label class="check"><input type="checkbox" name="available" ${state.availableOnly ? "checked" : ""}/> In stock</label>
          <label class="check"><input type="checkbox" name="favorites" ${state.favoritesOnly ? "checked" : ""}/> Favorites</label>
          <label class="check"><input type="checkbox" name="seasonal" ${state.seasonalOnly ? "checked" : ""}/> Seasonal</label>
        </form>
        <p class="count">${cocktails.length} cocktail${cocktails.length === 1 ? "" : "s"}</p>
        <div class="list">${rows || `<p class="empty">No cocktails match.</p>`}</div>
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
                <div class="thumb ${r.image ? "" : "thumb-empty"}">
                  ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
                </div>
                <div class="row-body">
                  <div class="row-title">${esc(r.name)}</div>
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
              ${c.favorite ? "Unfavorite" : "Favorite"}
            </button>
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
    });
    const rows = rimmers
      .map(
        (r) => `
          <a class="cocktail-row" href="#/rimmer/${r.id}" data-go="#/rimmer/${r.id}">
            <div class="thumb ${r.image ? "" : "thumb-empty"}">
              ${r.image ? `<img src="${esc(r.image)}" alt="">` : ""}
            </div>
            <div class="row-body">
              <div class="row-title">${esc(r.name)}</div>
              <div class="row-meta">${esc((r.kind || "rimmer").replace(/^./, (c) => c.toUpperCase()))}</div>
            </div>
            <div class="row-qty">${r.quantity}</div>
          </a>`
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
            <h1 class="detail-title">${esc(r.name)}</h1>
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

  function renderPeople() {
    const people = BartesianDB.listPeople();
    return shell(
      "people",
      `
      <section class="panel">
        <p class="section-label">Household</p>
        <h1>People</h1>
        <p class="lede">Raters for cocktail comments. Add household members or guests.</p>
        <ul class="plain">
          ${people.map((p) => `<li>${esc(p.name)}</li>`).join("") || `<li class="muted">None yet.</li>`}
        </ul>
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
        <p>Writes cocktail/pack/rimmer <code>.txt</code> files (including capsule/case barcodes), plus <code>barcodes.json</code>, ratings, and people. Copy into <code>data/</code>, run <code>node scripts/import-data.js</code>, then commit.</p>
        <button type="button" data-export>Export data</button>
        <p class="hint" data-export-status></p>
        <h2>Barcodes</h2>
        <p><a href="#/admin/barcodes" data-go="#/admin/barcodes">Associate scanned codes</a> with cocktails, cases, packs, or rimmers. Capsule lid numbers auto-match when present in the romkal drink map.</p>
        <h2>Force refresh</h2>
        <p>For iPad / PWA: unregister the service worker, clear caches, and reload. Keeps your local inventory database.</p>
        <p class="muted">Current build: <code>${esc(APP_VERSION)}</code></p>
        <button type="button" data-force-refresh>Force refresh</button>
        <h2>Local database</h2>
        <p>Clear IndexedDB and re-seed from <code>js/seed-data.js</code>.</p>
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

  function render() {
    const route = parseHash();
    // Stop camera when leaving scan/admin
    if (
      state.cameraOn &&
      route.view !== "scan" &&
      route.view !== "admin-barcodes"
    ) {
      stopCamera();
    }
    if (route.view === "detail") root.innerHTML = renderDetail(route.id);
    else if (route.view === "rimmers") root.innerHTML = renderRimmers();
    else if (route.view === "rimmer-detail") root.innerHTML = renderRimmerDetail(route.id);
    else if (route.view === "scan") root.innerHTML = renderScan();
    else if (route.view === "admin-barcodes") root.innerHTML = renderAdminBarcodes();
    else if (route.view === "random") root.innerHTML = renderRandom();
    else if (route.view === "people") root.innerHTML = renderPeople();
    else if (route.view === "settings") root.innerHTML = renderSettings();
    else if (route.view === "disclaimer") root.innerHTML = renderDisclaimer();
    else root.innerHTML = renderList();
    state.flash = "";
  }

  async function onClick(e) {
    const goEl = e.target.closest("[data-go]");
    if (goEl) {
      e.preventDefault();
      go(goEl.getAttribute("data-go"));
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
      state.seasonalOnly = listForm.seasonal ? listForm.seasonal.checked : false;
      render();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm) {
      e.preventDefault();
      const fd = new FormData(rimmerForm);
      state.rimmerSearch = String(fd.get("search") || "");
      state.rimmerKind = String(fd.get("kind") || "");
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
      box.innerHTML = `
        <div class="random-card">
          <h2>${esc(pick.name)}</h2>
          <p>${esc((pick.spirits_csv || "").split("|").filter(Boolean).join(", "))} · qty ${pick.quantity}</p>
          <a href="#/cocktail/${pick.id}" data-go="#/cocktail/${pick.id}">Open cocktail</a>
        </div>
      `;
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
      const cocktails = BartesianDB.listCocktails({
        search: state.search,
        sort: state.sort,
        spirit: state.spirit,
        favoritesOnly: state.favoritesOnly,
        availableOnly: state.availableOnly,
        seasonalOnly: state.seasonalOnly,
      });
      const list = root.querySelector(".list");
      const count = root.querySelector(".count");
      if (count) count.textContent = `${cocktails.length} cocktail${cocktails.length === 1 ? "" : "s"}`;
      if (list) {
        list.innerHTML =
          cocktails
            .map((c) => {
              const spiritsText = (c.spirits_csv || "").split("|").filter(Boolean).join(", ");
              const thumb = primaryImage(c);
              return `
              <a class="cocktail-row" href="#/cocktail/${c.id}" data-go="#/cocktail/${c.id}">
                <div class="thumb ${thumb ? "" : "thumb-empty"}">
                  ${thumb ? `<img src="${esc(thumb)}" alt="">` : ""}
                </div>
                <div class="row-body">
                  <div class="row-title">${esc(c.name)}${c.favorite ? " ★" : ""}${c.seasonal ? ' <span class="pill">Seasonal</span>' : ""}</div>
                  <div class="row-meta">${esc(spiritsText || "—")} · ${starsLabel(c.avg_rating)}</div>
                </div>
                <div class="row-qty">${c.quantity}</div>
              </a>`;
            })
            .join("") || `<p class="empty">No cocktails match.</p>`;
      }
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
    if (listForm && ["spirit", "sort", "available", "favorites", "seasonal"].includes(e.target.name)) {
      state.spirit = listForm.spirit.value;
      state.sort = listForm.sort.value;
      state.availableOnly = listForm.available.checked;
      state.favoritesOnly = listForm.favorites.checked;
      state.seasonalOnly = listForm.seasonal ? listForm.seasonal.checked : false;
      render();
      return;
    }

    const rimmerForm = e.target.closest("[data-rimmer-filters]");
    if (rimmerForm && e.target.name === "kind") {
      state.rimmerKind = rimmerForm.kind.value;
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
      render();
    } catch (err) {
      root.innerHTML = `<div class="boot error">Failed to start: ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  window.addEventListener("hashchange", render);
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

  boot();
})();
