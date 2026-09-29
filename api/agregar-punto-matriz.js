// ══════════════════════════════════════════════════════════
//  /api/agregar-punto-matriz — geocodifica una dirección nueva y
//  calcula el tiempo de viaje hacia/desde TODOS los puntos que ya
//  están en flota_matriz_tiempos, agregando las filas nuevas.
//
//  Usa la clave de Google Maps SOLO acá (variable de entorno de
//  Vercel, nunca en el código que llega al navegador) y la clave
//  pública de Supabase para escribir (la tabla ya es de lectura
//  abierta, sin necesitar la service_role).
//
//  Necesita esta variable de entorno en Vercel:
//    GOOGLE_MAPS_API_KEY
// ══════════════════════════════════════════════════════════
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const SUPABASE_URL = "https://lrwwpulunfcavmvmwotd.supabase.co";
const SUPABASE_KEY = "sb_publishable_SrUcYrDVBIOvZgF-DSPcyg_qV0LXEDQ";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    res.status(500).json({ error: "Falta GOOGLE_MAPS_API_KEY en las variables de entorno de Vercel." });
    return;
  }

  try {
    const { nombre, direccion } = req.body || {};
    if (!nombre || !direccion) {
      res.status(400).json({ error: "Faltan nombre y/o dirección." });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: ws } });

    // Puntos ya existentes en la matriz (uno por nombre, con su origen ya calculado)
    const { data: filasExistentes, error: errLeer } = await supabase.from("flota_matriz_tiempos").select("origen");
    if (errLeer) throw errLeer;
    const puntosExistentes = [...new Set((filasExistentes || []).map((f) => f.origen))];
    if (puntosExistentes.some((p) => p.toLowerCase() === nombre.toLowerCase())) {
      res.status(400).json({ error: `Ya existe un punto llamado "${nombre}" en la matriz.` });
      return;
    }
    if (!puntosExistentes.length) {
      res.status(400).json({ error: "La matriz está vacía — no hay ningún punto contra el cual calcular." });
      return;
    }

    // Geocodificar la dirección nueva
    const direccionUrl = encodeURIComponent(direccion);
    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${direccionUrl}&key=${GOOGLE_KEY}`);
    const geoData = await geoRes.json();
    if (geoData.status !== "OK" || !geoData.results.length) {
      res.status(400).json({ error: `No se pudo ubicar esa dirección (${geoData.status}). Probá agregar más detalle (calle, número, localidad).` });
      return;
    }
    const loc = geoData.results[0].geometry.location; // {lat, lng}
    const nuevoOrigen = `${loc.lat},${loc.lng}`;

    // Distance Matrix: nuevo punto -> todos los existentes, y todos los existentes -> nuevo punto.
    // Como no tenemos guardadas las coordenadas de los puntos existentes (solo sus
    // nombres), usamos el nombre + ", Mar del Plata, Argentina" como dirección para
    // que Google los geocodifique de nuevo en el mismo pedido.
    const destinosStr = puntosExistentes.map((p) => encodeURIComponent(p + ", Mar del Plata, Argentina")).join("|");

    const [idaRes, vueltaRes] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${nuevoOrigen}&destinations=${destinosStr}&mode=driving&key=${GOOGLE_KEY}`),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${destinosStr}&destinations=${nuevoOrigen}&mode=driving&key=${GOOGLE_KEY}`),
    ]);
    const [idaData, vueltaData] = await Promise.all([idaRes.json(), vueltaRes.json()]);

    if (idaData.status !== "OK" || vueltaData.status !== "OK") {
      res.status(500).json({ error: "Error de Google Distance Matrix: " + idaData.status + " / " + vueltaData.status });
      return;
    }

    const filasNuevas = [];
    const idaElementos = idaData.rows[0].elements;
    puntosExistentes.forEach((p, i) => {
      if (idaElementos[i].status === "OK") {
        filasNuevas.push({ origen: nombre, destino: p, minutos: Math.round((idaElementos[i].duration.value / 60) * 10) / 10 });
      }
      const elVuelta = vueltaData.rows[i].elements[0];
      if (elVuelta && elVuelta.status === "OK") {
        filasNuevas.push({ origen: p, destino: nombre, minutos: Math.round((elVuelta.duration.value / 60) * 10) / 10 });
      }
    });

    if (!filasNuevas.length) {
      res.status(500).json({ error: "No se pudo calcular ningún tramo — revisá la dirección." });
      return;
    }

    const { error: errInsert } = await supabase.from("flota_matriz_tiempos").insert(filasNuevas);
    if (errInsert) throw errInsert;

    res.status(200).json({ ok: true, filas: filasNuevas.length, punto: nombre });
  } catch (e) {
    console.error("agregar-punto-matriz error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
};
