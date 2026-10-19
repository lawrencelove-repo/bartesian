/* Bartesian app shell service worker — offline-friendly cache for static assets. */
const CACHE_VERSION = "bartesian-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/seed-data.js",
  "./js/db.js",
  "./js/export.js",
  "./js/app.js",
  "./assets/favicon/favicon.ico",
  "./assets/favicon/favicon-16x16.png",
  "./assets/favicon/favicon-32x32.png",
  "./assets/favicon/apple-touch-icon.png",
  "./assets/favicon/android-chrome-192x192.png",
  "./assets/favicon/android-chrome-512x512.png",
  "./assets/favicon/site.webmanifest",
  "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.js",
  "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
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

  event.respondWith(
    caches.match(request).then((cached) => {
      const networked = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});
