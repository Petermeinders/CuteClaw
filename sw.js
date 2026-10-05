const CACHE_NAME = "cutyclaw-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./game.js",
  "./manifest.json",
  "./assets/icons/favicon.ico",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/plush/corgi.webp",
  "./assets/plush/fluffy-cat.webp",
  "./assets/plush/tuxedo-cat.webp",
  "./assets/plush/kitten-purple.webp",
  "./assets/plush/rabbit.webp",
  "./assets/plush/elephant.webp",
  "./assets/plush/octopus.webp",
  "./assets/plush/owl.webp",
  "./assets/plush/turtle.webp",
  "./assets/plush/whale.webp",
  "./assets/plush/dolphin.webp",
  "./assets/plush/bluebird.webp",
  "./assets/plush/frog.webp",
  "./assets/plush/snake.webp",
  "./assets/plush/starfish.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Cache-first for same-origin GETs so the machine keeps working offline once played.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
