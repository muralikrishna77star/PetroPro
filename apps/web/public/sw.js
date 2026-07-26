const CACHE_NAME = "petropro-shell-v5";
const SHELL_URLS = [
  "/",
  "/login",
  "/attendant",
  "/cashier",
  "/billing",
  "/customers",
  "/catalog",
  "/purchases",
  "/rate-changes",
  "/shifts",
  "/reports",
  "/audit-logs",
  "/users",
  "/dashboard",
  "/settings",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigations/API calls so live data wins when online; cached app-shell
// is the offline fallback. This app does not cache API responses (Phase 4 owns real
// offline sync via the sync_queue table — see docs/ROADMAP.md).
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.mode === "navigate") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/"))),
  );
});
