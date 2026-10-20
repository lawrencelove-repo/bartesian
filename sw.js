/* Bartesian app shell service worker — offline-friendly cache for static assets. */
const CACHE_VERSION = "bartesian-v68";
const PRECACHE = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./css/book-mode.css",
  "./js/seed-data.js",
  "./js/pods-barcode-map.js",
  "./js/db.js",
  "./js/export.js",
  "./js/bartesian-code128.js",
  "./js/retail-barcode.js",
  "./js/camera-scan.js",
  "./js/barcodes.js",
  "./js/icons.js",
  "./js/app.js",
  "./assets/favicon/favicon.ico",
  "./assets/favicon/favicon-16x16.png",
  "./assets/favicon/favicon-32x32.png",
  "./assets/favicon/apple-touch-icon.png",
  "./assets/favicon/android-chrome-192x192.png",
  "./assets/favicon/android-chrome-512x512.png",
  "./assets/favicon/site.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch(() => {
              /* skip missing optional assets so install still succeeds */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations: always prefer the live server so a different app on the same
  // port (e.g. recipes) cannot keep showing a cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networked = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        // Prefer network for JS/CSS so port reuse does not keep a sibling app's assets.
        if (/\.(js|css)$/i.test(url.pathname)) {
          return networked;
        }
        return cached || networked;
      })
    );
    return;
  }

  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
            return response;
          })
      )
    );
  }
});
