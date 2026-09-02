// Service Worker de TransferLog — solo se ocupa de las notificaciones push.
// No cachea nada de la app (para no complicar actualizaciones).

self.addEventListener("push", (event) => {
  let data = { title: "TransferLog", body: "Tenés una notificación nueva" };
  try { if (event.data) data = event.data.json(); } catch (e) {}

  const options = {
    body: data.body,
    icon: "https://cdn-icons-png.flaticon.com/512/2830/2830284.png",
    badge: "https://cdn-icons-png.flaticon.com/512/2830/2830284.png",
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
