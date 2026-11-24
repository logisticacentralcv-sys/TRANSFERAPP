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

    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const existente = (direccionesExistentes || []).find((d) => norm(d.nombre) === norm(nombre));
    if (existente && !reemplazar) {
      // Mismo lugar ya cargado (ej. otra transferencia a la misma dirección): se reutiliza, no es un error
      if (norm(existente.direccion) === norm(direccion)) {
        res.status(200).json({ ok: true, reutilizado: true, punto: existente.nombre, encontrada: existente.direccion });
        return;
      }
      res.status(400).json({ error: `Ya existe un lugar llamado "${existente.nombre}" con otra dirección (${existente.direccion}). Usá otro nombre corto, o elegilo de los ya cargados.`, existente: { nombre: existente.nombre, direccion: existente.direccion } });
      return;
    }

    if (reemplazar) {
      await supabase.from("flota_direcciones").delete().eq("nombre", nombre);
    }

    // Sin repetidos (el mismo lugar cargado dos veces daba "duplicate key")
    const vistos = new Set();
    const puntosExistentes = (direccionesExistentes || []).filter((d) => {
      const k = norm(d.nombre);
      if (!k || k === norm(nombre) || vistos.has(k)) return false;
      vistos.add(k); return true;
    });
    if (!puntosExistentes.length) {
      res.status(400).json({ error: "Todavía no hay ningún punto con dirección guardada contra el cual calcular (correr primero flota_07_direcciones.sql)." });
      return;
    }

    // Geocodificar la dirección nueva
    const direccionUrl = encodeURIComponent(direccion);
    // Solo en Argentina, priorizando Mar del Plata y alrededores (así no aparece una calle igual de otro país)
    const zona = "&region=ar&components=country:AR&bounds=-38.20,-57.80|-37.80,-57.40&language=es";
    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${direccionUrl}${zona}&key=${GOOGLE_KEY}`);
    const geoData = await geoRes.json();
    if (geoData.status !== "OK" || !geoData.results.length) {
      res.status(400).json({ error: geoData.status === "ZERO_RESULTS"
        ? "Google no encontró esa dirección. Probá con calle, número y localidad (ej: Av. Colón 1234, Mar del Plata)."
        : `No se pudo ubicar esa dirección (${geoData.status}).` });
      return;
    }
    const encontrada = geoData.results[0].formatted_address || direccion;
    const loc = geoData.results[0].geometry.location; // {lat, lng}
    const nuevoOrigen = `${loc.lat},${loc.lng}`;

    // Distance Matrix con las DIRECCIONES REALES de los puntos existentes, DE A 25
    // (Google acepta hasta 25 lugares por consulta; con más, fallaba siempre)
    const filasNuevas = [];
    for (let k = 0; k < puntosExistentes.length; k += 25) {
      const lote = puntosExistentes.slice(k, k + 25);
      const destinosStr = lote.map((p) => encodeURIComponent(p.direccion)).join("|");
      const [idaRes, vueltaRes] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${nuevoOrigen}&destinations=${destinosStr}&mode=driving&key=${GOOGLE_KEY}`),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${destinosStr}&destinations=${nuevoOrigen}&mode=driving&key=${GOOGLE_KEY}`),
      ]);
      const [idaData, vueltaData] = await Promise.all([idaRes.json(), vueltaRes.json()]);
      if (idaData.status !== "OK" || vueltaData.status !== "OK") {
        res.status(500).json({ error: "Error de Google Distance Matrix: " + idaData.status + " / " + vueltaData.status });
        return;
      }
      const idaElementos = idaData.rows[0].elements;
      lote.forEach((p, i) => {
        if (idaElementos[i] && idaElementos[i].status === "OK") {
          filasNuevas.push({ origen: nombre, destino: p.nombre, minutos: Math.round((idaElementos[i].duration.value / 60) * 10) / 10 });
        }
        const elVuelta = vueltaData.rows[i] && vueltaData.rows[i].elements[0];
        if (elVuelta && elVuelta.status === "OK") {
          filasNuevas.push({ origen: p.nombre, destino: nombre, minutos: Math.round((elVuelta.duration.value / 60) * 10) / 10 });
        }
      });
    }

    if (!filasNuevas.length) {
      res.status(500).json({ error: "No se pudo calcular ningún tramo — revisá la dirección." });
      return;
    }

    // Lo que hubiera de este lugar (de un intento anterior) se reemplaza: así nunca se duplica
    await supabase.from("flota_matriz_tiempos").delete().eq("origen", nombre);
    await supabase.from("flota_matriz_tiempos").delete().eq("destino", nombre);
    const unicas = [...new Map(filasNuevas.map((f) => [norm(f.origen) + "→" + norm(f.destino), f])).values()];
    const { error: errInsert } = await supabase.from("flota_matriz_tiempos").insert(unicas);
    if (errInsert) throw errInsert;

    await supabase.from("flota_direcciones").delete().eq("nombre", nombre);
    const { error: errDireccion } = await supabase.from("flota_direcciones").insert({
      nombre, direccion, lat: loc.lat, lon: loc.lng, es_original: false,
    });
    if (errDireccion) throw errDireccion;

    res.status(200).json({ ok: true, filas: filasNuevas.length, punto: nombre, encontrada });
  } catch (e) {
    console.error("agregar-punto-matriz error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
};
