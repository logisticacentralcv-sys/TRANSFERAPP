// Service Worker de TransferLog — solo se ocupa de las notificaciones push.
// No cachea nada de la app (para no complicar actualizaciones).

// Ícono de camión, como SVG embebido — así no depende de ningún servicio
// externo (y no hay dudas de qué imagen es).
const ICONO_CAMION = "data:image/svg+xml," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="192" height="192">
  <rect width="64" height="64" rx="12" fill="#e8a020"/>
  <g fill="#0b1624">
    <rect x="6" y="26" width="30" height="16" rx="2"/>
    <path d="M36 30h10l8 8v4h-18z"/>
    <rect x="4" y="40" width="46" height="4" rx="1"/>
    <circle cx="18" cy="46" r="6"/>
    <circle cx="44" cy="46" r="6"/>
    <circle cx="18" cy="46" r="2.4" fill="#e8a020"/>
    <circle cx="44" cy="46" r="2.4" fill="#e8a020"/>
  </g>
</svg>
`.trim());

self.addEventListener("push", (event) => {
  let data = { title: "TransferLog", body: "Tenés una notificación nueva" };
  try { if (event.data) data = event.data.json(); } catch (e) {}

  const options = {
    body: data.body,
    icon: ICONO_CAMION,
    badge: ICONO_CAMION,
    data: { solicitudId: data.solicitudId || null },
    tag: data.solicitudId || undefined, // agrupa notis de la misma solicitud
  };

  event.waitUntil(self.registration.showNotification(data.title || "TransferLog", options));
});

// Al tocar la notificación, abre (o enfoca) la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
