(function () {
  const root = document.getElementById("app");
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
  };

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

  function renderScan() {
    return shell(
      "scan",
      `
      <section class="panel">
        <p class="section-label">Inventory</p>
        <h1>Scan barcode</h1>
        <p class="lede">Scaffold: type or paste a barcode. Camera scanning can come later.</p>
        <ul class="plain muted">
          <li>Capsule → subtract 1</li>
          <li>Case → add case qty (usually 8)</li>
          <li>Variety pack → add each included cocktail</li>
        </ul>
        <form class="scan-form" data-scan-form>
          <input name="code" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode" required autofocus />
          <button type="submit">Apply</button>
        </form>
        <p class="hint">Sample capsule: <code>850000000001</code> · case: <code>850000000101</code> · variety: <code>850000009001</code></p>
        <div data-scan-result></div>
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
        <p>Writes cocktail/pack/rimmer <code>.txt</code> files (and ratings/people JSON in the zip). Copy into <code>data/</code>, run <code>node scripts/import-data.js</code>, then commit.</p>
        <button type="button" data-export>Export data</button>
        <p class="hint" data-export-status></p>
        <h2>Local database</h2>
        <p>Clear IndexedDB and re-seed from <code>js/seed-data.js</code>.</p>
        <button type="button" class="danger" data-reset>Reset local DB</button>
      </section>
    `
    );
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
    if (route.view === "detail") root.innerHTML = renderDetail(route.id);
    else if (route.view === "rimmers") root.innerHTML = renderRimmers();
    else if (route.view === "rimmer-detail") root.innerHTML = renderRimmerDetail(route.id);
    else if (route.view === "scan") root.innerHTML = renderScan();
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

    const scanForm = e.target.closest("[data-scan-form]");
    if (scanForm) {
      e.preventDefault();
      const code = new FormData(scanForm).get("code");
      const result = await BartesianDB.applyBarcode(code);
      const box = root.querySelector("[data-scan-result]");
      if (!box) return;
      if (!result.ok) {
        box.innerHTML = `<p class="error">${esc(result.error)}</p>`;
        return;
      }
      box.innerHTML = `
        <p class="ok">Applied <strong>${esc(result.kind)}</strong>:</p>
        <ul class="plain">
          ${result.changes
            .map(
              (ch) =>
                `<li>${esc(ch.cocktail.name)}: ${ch.delta >= 0 ? "+" : ""}${ch.delta} → ${ch.quantity}</li>`
            )
            .join("")}
        </ul>
      `;
      scanForm.reset();
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

  function onInput(e) {
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
  document.addEventListener("change", onChange);

  boot();
})();
