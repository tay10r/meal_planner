const CACHE = "meal-planner-v1";
const ASSETS = [
  "index.html",
  "recipes.html",
  "grocery.html",
  "style.css",
  "app.js",
  "data.json",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Network-first for data.json so updates to the bundled seed can be picked up if desired.
  if (req.url.endsWith("/data.json") || req.url.endsWith("data.json")) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for app shell
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
