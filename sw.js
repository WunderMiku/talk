/* talk. service worker — app shell only; model/audio caches stay in IndexedDB. */
const SHELL_CACHE = "talk-shell-v207";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=207",
  "./theme.css?v=207",
  "./themes/ussr.css?v=207",
  "./themes/rhine.css?v=207",
  "./themes/rhineaccess.css?v=207",
  "./themes/endfield.css?v=207",
  "./themes/bitterworld.css?v=207",
  "./themes/ussr-statue.svg?v=207",
  "./theme.js?v=207",
  "./content.js?v=207",
  "./prompts.js?v=207",
  "./data.js?v=207",
  "./app.js?v=207",
  "./vendor/idb.js",
  "./vendor/html-to-image.js?v=207",
  "./vendor/lenis.min.js?v=207",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
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
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
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
