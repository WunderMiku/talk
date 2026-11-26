/* talk. service worker — app shell only; model/audio caches stay in IndexedDB. */
const SHELL_CACHE = "talk-shell-v288";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css?v=288",
  "./css/theme.css?v=288",
  "./css/print-reader.css?v=288",
  "./css/themes/still.css?v=288",
  "./css/themes/constructivist.css?v=288",
  "./css/themes/swiss-lab.css?v=288",
  "./css/themes/archive-grid.css?v=288",
  "./css/themes/topo-acid.css?v=288",
  "./css/themes/retro-stub.css?v=288",
  "./css/themes/constructivist-statue.svg?v=288",
  "./js/theme.js?v=288",
  "./js/content.js?v=288",
  "./js/prompts.js?v=288",
  "./js/data.js?v=288",
  "./js/doc-parser.js?v=288",
  "./js/doc-reader.js?v=288",
  "./js/native-bridge.js?v=288",
  "./js/app.js?v=288",
  "./vendor/idb.js",
  "./vendor/html-to-image.js?v=288",
  "./vendor/lenis.min.js?v=288",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/style/minimal.svg",
  "./icons/style/idiom.svg",
  "./icons/style/formal.svg",
  "./icons/style/slang.svg",
  "./icons/style/elegant.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // Only clean up this project's own old shell caches; the origin may be
      // shared with other PWAs (e.g. *.github.io), whose caches must survive.
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("talk-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
