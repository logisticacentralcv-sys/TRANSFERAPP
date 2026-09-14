// Service Worker de TransferLog — solo se ocupa de las notificaciones push.
// No cachea nada de la app (para no complicar actualizaciones).

// Ícono de camión, como SVG embebido — así no depende de ningún servicio
// externo (y no hay dudas de qué imagen es).
const ICONO_CAMION = "data:image/svg+xml," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420" width="192" height="119">
  <style>
    .cab{fill:#ffffff;stroke:#000000;stroke-width:10;stroke-linejoin:round;stroke-linecap:round}
    .win{fill:#dfe6ec;stroke:#000000;stroke-width:8;stroke-linejoin:round}
    .box{fill:#181d24;stroke:#aab2bd;stroke-width:9;stroke-linejoin:round}
    .wheel{fill:#181d24;stroke:#000000;stroke-width:8}
    .hub{fill:#aab2bd}
  </style>
  <path class="cab" d="M50,300 L50,250 Q48,215 68,208 Q78,150 118,105 Q160,55 245,30 L320,30 L320,262 L296,262 L296,278 L580,278 Q596,278 596,294 L596,300 Z"/>
  <rect class="box" x="320" y="30" width="270" height="232" rx="14"/>
  <rect class="win" x="125" y="128" width="105" height="78" rx="6"/>
  <circle cx="58" cy="238" r="10" fill="#000000"/>
  <rect x="360" y="86" width="190" height="120" rx="20" fill="#4d7c3a" stroke="#f2c230" stroke-width="9"/>
  <text x="455" y="138" text-anchor="middle" font-size="24" font-weight="700" fill="#ffffff" font-family="sans-serif">CAMPO</text>
  <text x="455" y="172" text-anchor="middle" font-size="24" font-weight="700" fill="#ffffff" font-family="sans-serif">VERDE</text>
  <circle class="wheel" cx="155" cy="330" r="44"/>
  <circle class="hub" cx="155" cy="330" r="16"/>
  <circle cx="155" cy="330" r="6" fill="#000000"/>
  <circle class="wheel" cx="500" cy="330" r="44"/>
  <circle class="hub" cx="500" cy="330" r="16"/>
  <circle cx="500" cy="330" r="6" fill="#000000"/>
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
