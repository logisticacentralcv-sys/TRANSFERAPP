// ══════════════════════════════════════════════════════════
//  /api/agregar-punto-matriz — geocodifica una dirección y calcula
//  el tiempo de viaje hacia/desde TODOS los puntos que ya existen,
//  usando sus DIRECCIONES REALES guardadas (no adivinando por el
//  nombre) — así el cálculo es preciso incluso para nombres como
//  "Fábrica", que no son una dirección real por sí solos.
//
//  Con { reemplazar: true } en el pedido, primero borra lo que
//  hubiera de ese mismo nombre (matriz + dirección guardada) antes
//  de recalcular — se usa para "editar" un punto ya cargado.
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
    const { nombre, direccion, reemplazar } = req.body || {};
    if (!nombre || !direccion) {
      res.status(400).json({ error: "Faltan nombre y/o dirección." });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: ws } });

    // Direcciones reales ya guardadas (fábrica + sucursales + agregados a mano)
    const { data: direccionesExistentes, error: errLeer } = await supabase.from("flota_direcciones").select("nombre,direccion");
    if (errLeer) throw errLeer;

    const yaExiste = (direccionesExistentes || []).some((d) => d.nombre.toLowerCase() === nombre.toLowerCase());
    if (yaExiste && !reemplazar) {
      res.status(400).json({ error: `Ya existe un punto llamado "${nombre}". Si querés cambiarle la dirección, usá "Editar".` });
      return;
    }

    if (reemplazar) {
      await supabase.from("flota_matriz_tiempos").delete().or(`origen.eq.${nombre},destino.eq.${nombre}`);
      await supabase.from("flota_direcciones").delete().eq("nombre", nombre);
    }

    const puntosExistentes = (direccionesExistentes || []).filter((d) => d.nombre.toLowerCase() !== nombre.toLowerCase());
    if (!puntosExistentes.length) {
      res.status(400).json({ error: "Todavía no hay ningún punto con dirección guardada contra el cual calcular (correr primero flota_07_direcciones.sql)." });
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

    // Distance Matrix usando las DIRECCIONES REALES de los puntos existentes
    // (no sus nombres) — esto es lo que antes fallaba.
    const destinosStr = puntosExistentes.map((p) => encodeURIComponent(p.direccion)).join("|");

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
        filasNuevas.push({ origen: nombre, destino: p.nombre, minutos: Math.round((idaElementos[i].duration.value / 60) * 10) / 10 });
      }
      const elVuelta = vueltaData.rows[i].elements[0];
      if (elVuelta && elVuelta.status === "OK") {
        filasNuevas.push({ origen: p.nombre, destino: nombre, minutos: Math.round((elVuelta.duration.value / 60) * 10) / 10 });
      }
    });

    if (!filasNuevas.length) {
      res.status(500).json({ error: "No se pudo calcular ningún tramo — revisá la dirección." });
      return;
    }

    const { error: errInsert } = await supabase.from("flota_matriz_tiempos").insert(filasNuevas);
    if (errInsert) throw errInsert;

    const { error: errDireccion } = await supabase.from("flota_direcciones").insert({
      nombre, direccion, lat: loc.lat, lon: loc.lng, es_original: false,
    });
    if (errDireccion) throw errDireccion;

    res.status(200).json({ ok: true, filas: filasNuevas.length, punto: nombre });
  } catch (e) {
    console.error("agregar-punto-matriz error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
};
