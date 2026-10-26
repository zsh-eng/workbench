// Opens Arctic without a network: the app shell from cache, the library and
// saved text from IndexedDB. Hashed assets never change; pages try the network first.
//
// The cache keeps the files of two versions: the one the last page loaded,
// and the one before, which a tab opened earlier may still be running. A page
// of a new version caches its files, then becomes the offline page, and the
// files of older versions leave. A file that loads on demand (Defuddle) is
// cached when first used and leaves with its version.
const CACHE = "arctic-shell-v2";
/** The version kept last: `{ page, files }`, the assets its page names and all it keeps. */
const VERSION = "/__version.json";

async function addMissing(cache, paths) {
  const missing = [];
  for (const path of paths)
    if (!(await cache.match(path, { ignoreVary: true }))) missing.push(path);
  await cache.addAll(missing);
}

/**
 * Keeps a page for offline use with the hashed scripts and styles it names,
 * and the sheets' code. The sheets' code and style load after the first
 * page, so the page does not name them; the app's script does. Defuddle,
 * which only extracts a page, stays out.
 */
async function keepPage(page) {
  const cache = await caches.open(CACHE);
  const html = await page.clone().text();
  const assets = [...new Set(html.match(/\/assets\/[\w.-]+/g) ?? [])].sort();
  const kept = await cache
    .match(VERSION)
    .then((saved) => saved?.json())
    .catch(() => undefined);
  if (kept?.page?.join() === assets.join()) {
    await cache.put("/", page);
    return;
  }
  await addMissing(cache, assets);
  const scripts = await Promise.all(
    assets
      .filter((asset) => asset.endsWith(".js"))
      .map(async (asset) => (await cache.match(asset))?.text() ?? ""),
  );
  const sheets = scripts.flatMap(
    (script) => script.match(/assets\/sheet-[\w-]+\.(?:js|css)/g) ?? [],
  );
  const files = [
    ...new Set([...assets, ...sheets.map((sheet) => `/${sheet}`)]),
  ];
  await addMissing(cache, files);
  await cache.put("/", page);
  // This version's files and the last one's stay; older ones leave.
  const keep = new Set([...files, ...(kept?.files ?? [])]);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path))
      await cache.delete(request);
  }
  await cache.put(
    VERSION,
    new Response(JSON.stringify({ page: assets, files }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await keepPage(await fetch("/", { cache: "no-cache" }));
      const cache = await caches.open(CACHE);
      await cache.addAll(["/appearance.js", "/icon-64.png", "/favicon.png"]);
    })(),
  );
  self.skipWaiting();
});

// Older caches go, with every version that they kept.
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
          if (response.ok)
            event.waitUntil(keepPage(response.clone()).catch(() => {}));
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
      caches
        .match(request, { ignoreVary: true })
        .then((cached) => cached ?? fresh),
    );
    return;
  }
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icon-")
  ) {
    // Hashed files never change. A module script asks with an Origin header
    // that the installed copy lacks, so a Vary header must not hide it. A
    // sheet that failed to load asks again with a query (surface.tsx), which
    // the installed copy answers too.
    event.respondWith(
      caches.match(request, { ignoreVary: true, ignoreSearch: true }).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok)
              event.waitUntil(
                caches
                  .open(CACHE)
                  .then((cache) => cache.put(url.pathname, copy)),
              );
            return response;
          }),
      ),
    );
  }
});
