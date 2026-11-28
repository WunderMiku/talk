/* talk. service worker — app shell only; model/audio caches stay in IndexedDB. */
const SHELL_CACHE = "talk-shell-v295";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css?v=295",
  "./css/theme.css?v=295",
  "./css/print-reader.css?v=295",
  "./css/themes/still.css?v=295",
  "./css/themes/constructivist.css?v=295",
  "./css/themes/swiss-lab.css?v=295",
  "./css/themes/archive-grid.css?v=295",
  "./css/themes/topo-acid.css?v=295",
  "./css/themes/retro-stub.css?v=295",
  "./css/themes/constructivist-statue.svg?v=295",
  "./js/theme.js?v=295",
  "./js/content.js?v=295",
  "./js/prompts.js?v=295",
  "./js/llm-client.js?v=295",
  "./js/data.js?v=295",
  "./js/i18n.js?v=295",
  "./js/wordbooks.js?v=295",
  "./js/doc-parser.js?v=295",
  "./js/doc-reader.js?v=295",
  "./js/native-bridge.js?v=295",
  "./js/app.js?v=295",
  // @shell-esm-start
  "./js/core/actions.js",
  "./js/core/diagnostics.js",
  "./js/core/icons.js",
  "./js/core/utils.js",
  "./js/features/share.js",
  "./js/features/theme-salon.js",
  "./js/features/tts.js",
  "./js/model/markdown.js",
  "./js/model/normalize.js",
  "./js/model/stream-preview.js",
  "./js/storage/vault.js",
  "./js/views/chunk.js",
  "./js/views/reverse.js",
  "./js/views/sentence.js",
  "./js/views/status.js",
  "./js/views/translator.js",
  "./js/views/word.js",
  // @shell-esm-end
  "./vendor/idb.js",
  "./vendor/html-to-image.js?v=295",
  "./vendor/lenis.min.js?v=295",
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
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
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
