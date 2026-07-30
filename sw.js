// Service worker mínimo, solo para que el navegador ofrezca "Instalar app".
// No cachea nada de forma agresiva: siempre deja pasar las peticiones a la red,
// para que Casa en Casa siga mostrando datos frescos de Firebase/Stripe.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
