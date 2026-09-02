// ══════════════════════════════════════════════════════════
//  /api/send-push — envía una notificación push real (llega aunque
//  el navegador esté cerrado) a los dispositivos suscriptos que
//  correspondan al "destinatario" (grupo) indicado.
//
//  Se llama desde el cliente (crearNotificacion) con:
//    fetch('/api/send-push', {method:'POST', body: JSON.stringify({destinatario, mensaje, solicitudId})})
//
//  Necesita 2 variables de entorno configuradas en Vercel:
//    VAPID_PUBLIC_KEY   (la misma que está hardcodeada en index.html)
//    VAPID_PRIVATE_KEY  (secreta — nunca va en el código)
// ══════════════════════════════════════════════════════════
const webpush = require("web-push");

const SUPABASE_URL = "https://lrwwpulunfcavmvmwotd.supabase.co";
const SUPABASE_KEY = "sb_publishable_SrUcYrDVBIOvZgF-DSPcyg_qV0LXEDQ";

function normGrupo(s) {
  return (s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { destinatario, mensaje, solicitudId } = req.body || {};
    if (!destinatario || !mensaje) {
      res.status(400).json({ error: "Falta destinatario o mensaje" });
      return;
    }

    webpush.setVapidDetails(
      "mailto:soporte@transferlog.app",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    // Traer todas las suscripciones (la tabla es chica, filtramos acá
    // mismo para poder normalizar tildes/mayúsculas al comparar)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const subs = await r.json();
    const destinoNorm = normGrupo(destinatario);
    const objetivo = subs.filter((s) => normGrupo(s.grupo) === destinoNorm);

    const payload = JSON.stringify({
      title: "TransferLog",
      body: mensaje,
      solicitudId: solicitudId || null,
    });

    const resultados = await Promise.allSettled(
      objetivo.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload)
      )
    );

    // Si una suscripción ya no es válida (410/404), la borramos para
    // no seguir intentando mandarle en vano.
    const vencidas = [];
    resultados.forEach((r2, i) => {
      if (r2.status === "rejected") {
        const code = r2.reason && r2.reason.statusCode;
        if (code === 410 || code === 404) vencidas.push(objetivo[i].endpoint);
      }
    });
    if (vencidas.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=in.(${vencidas.map((e) => `"${e}"`).join(",")})`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
    }

    res.status(200).json({ ok: true, enviados: objetivo.length - vencidas.length });
  } catch (e) {
    console.error("send-push error:", e);
    res.status(500).json({ error: "internal error" });
  }
};
