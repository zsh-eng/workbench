// Opens Arctic without a network: the app shell from cache, the library and
// saved text from IndexedDB. Hashed assets never change; pages try the network first.
const CACHE = "arctic-shell-v1";

// The page and the hashed scripts and styles it names, so the first offline open works.
async function install() {
  const cache = await caches.open(CACHE);
  const page = await fetch("/", { cache: "no-cache" });
  const html = await page.clone().text();
  await cache.put("/", page);
  const assets = [...new Set(html.match(/\/assets\/[\w.-]+/g) ?? [])];
  await cache.addAll([
    ...assets,
    "/appearance.js",
    "/icon-64.png",
    "/favicon.png",
  ]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(install());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok)
            void caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // The theme script runs before every paint: the cached copy at once, the
  // network's for next time.
  if (url.pathname === "/appearance.js") {
    const fresh = fetch(request).then(async (response) => {
      if (response.ok)
        await (await caches.open(CACHE)).put(request, response.clone());
      return response;
    });
    event.waitUntil(fresh.catch(() => {}));
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fresh),
    );
    return;
  }
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icon-")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok)
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
