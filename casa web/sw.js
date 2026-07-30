// Service worker que fuerza actualización automática cuando hay cambios.
const VERSION = "v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Siempre va a la red, nunca sirve desde caché
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
