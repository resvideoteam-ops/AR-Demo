// Bump CACHE_VERSION on every deploy that changes ar.html, index.html or the model.
const CACHE_VERSION = "ar-demo-v2";

// Only the small landing shell is precached. The heavy assets (3.1 MB of libraries,
// the 3.9 MB model) are cached on first real use instead, so installing the app does
// not block on an 8 MB download.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

const RUNTIME_CACHEABLE = /\.(?:glb|patt|js|png|svg|pdf)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Individual failures must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML is network-first so a redeploy is picked up instead of being pinned
  // to a stale cached page.
  const isHTML = request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  if (!RUNTIME_CACHEABLE.test(url.pathname)) return;

  // Large static assets: serve from cache, populate on first use.
  // ignoreSearch keeps the ?v= query on the model from splitting cache entries.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
