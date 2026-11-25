// ══════════════════════════════════════════════════════════
//  /api/whatsapp-transferencia — avisa por WhatsApp a las sucursales
//  cuando se genera una transferencia (WhatsApp Business Platform de Meta).
//
//  Solo manda el MODELO aprobado en Meta, con los datos de una transferencia
//  real y a los números cargados en la app (Admin → Configuración), así que
//  no se puede usar para mandar cualquier mensaje.
//
//  Variables de entorno en Vercel:
//    WHATSAPP_TOKEN            token permanente (usuario del sistema de Meta)
//    WHATSAPP_PHONE_NUMBER_ID  el "Phone number ID" del número de WhatsApp Business
//    WHATSAPP_TEMPLATE         (opcional) nombre del modelo; por defecto "nueva_transferencia"
//    WHATSAPP_LANG             (opcional) idioma del modelo; por defecto "es_AR"
//
//  El modelo tiene 4 variables en el cuerpo, en este orden:
//    {{1}} número de transferencia · {{2}} origen · {{3}} destino · {{4}} qué es
// ══════════════════════════════════════════════════════════
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://lrwwpulunfcavmvmwotd.supabase.co";
const SUPABASE_KEY = "sb_publishable_SrUcYrDVBIOvZgF-DSPcyg_qV0LXEDQ";
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");

async function enviar(numero, params) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const body = {
    messaging_product: "whatsapp",
    to: soloDigitos(numero),
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE || "nueva_transferencia",
      language: { code: process.env.WHATSAPP_LANG || "es_AR" },
      components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t || "—").slice(0, 200) })) }],
    },
  };
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `WhatsApp respondió ${r.status}`);
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    res.status(500).json({ error: "Falta configurar WhatsApp en Vercel (WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID)." });
    return;
  }
  try {
    const { solicitudId, prueba, sucursal, excluir } = req.body || {};
    // Con la sesión de quien llama (respeta los permisos de la base)
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {} },
      auth: { persistSession: false },
    });
    const { data: cfg } = await supabase.from("config").select("clave,valor").in("clave", ["whatsapp_activo", "whatsapp_sucursales"]);
    const val = (k) => ((cfg || []).find((x) => x.clave === k) || {}).valor;
    let numeros = {};
    try { numeros = JSON.parse(val("whatsapp_sucursales") || "{}") || {}; } catch (e) {}
    const numeroDe = (suc) => { const k = Object.keys(numeros).find((n) => norm(n) === norm(suc)); return k ? numeros[k] : ""; };

    if (prueba) {
      const num = numeroDe(sucursal);
      if (!num) { res.status(400).json({ error: `No hay número cargado para ${sucursal}.` }); return; }
      await enviar(num, ["PRUEBA", "TransferLog", sucursal, "Mensaje de prueba"]);
      res.status(200).json({ ok: true, enviados: [sucursal] });
      return;
    }

    if (val("whatsapp_activo") !== "si") { res.status(200).json({ ok: true, enviados: [], motivo: "desactivado" }); return; }
    if (!solicitudId) { res.status(400).json({ error: "Falta solicitudId" }); return; }
    const { data: s, error } = await supabase.from("solicitudes").select("*").eq("id", solicitudId).single();
    if (error || !s) { res.status(404).json({ error: "No se encontró la transferencia" }); return; }

    // A quién: la sucursal de origen (la prepara) y la de destino (se la llevan), salvo la que la cargó
    const destinatarios = [...new Set([s.sucursal, s.destino].filter(Boolean))].filter((x) => norm(x) !== norm(excluir));
    const params = [s.id, s.sucursal || s.area || "—", s.destino || "—", s.descripcion || "—"];
    const enviados = [], fallas = [];
    for (const suc of destinatarios) {
      const num = numeroDe(suc);
      if (!num) continue;
      try { await enviar(num, params); enviados.push(suc); } catch (e) { fallas.push({ sucursal: suc, error: e.message }); }
    }
    res.status(200).json({ ok: true, enviados, fallas });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
