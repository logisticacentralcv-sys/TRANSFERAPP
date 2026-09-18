// ══════════════════════════════════════════════════════════
//  /api/crear-usuario-auth — crea la cuenta de Supabase Auth para
//  un usuario recién dado de alta desde el panel de Admin, y la
//  enlaza en la tabla usuarios (auth_user_id, y password si
//  corresponde). Se llama automáticamente desde guardarUsuario()
//  apenas se crea la fila — Admin no tiene que correr ningún script.
//
//  Usa la clave "service_role" (SOLO existe acá, en el servidor —
//  nunca en el código que llega al navegador) para poder crear
//  cuentas de Auth, algo que la clave pública no puede hacer.
//
//  Necesita esta variable de entorno en Vercel:
//    SUPABASE_SERVICE_ROLE_KEY
// ══════════════════════════════════════════════════════════
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://lrwwpulunfcavmvmwotd.supabase.co";

function loginToEmail(usuario) {
  const limpio = String(usuario || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
  return `${limpio}@transferlog.internal`;
}

function generarPasswordAlAzar() {
  const crypto = require("crypto");
  return crypto.randomBytes(18).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Vercel." });
    return;
  }

  try {
    const { usuario, tipo, dni, password } = req.body || {};
    if (!usuario || !tipo || !dni) {
      res.status(400).json({ error: "Faltan datos (usuario, tipo, dni)." });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Sucursal y Repartidor nunca escriben contraseña -> se genera una
    // al azar, invisible, para que la app los loguee solos.
    const sinPasswordVisible = tipo === "SUCURSAL" || tipo === "REPARTIDOR";
    const passwordFinal = sinPasswordVisible ? generarPasswordAlAzar() : String(password || "");

    if (!sinPasswordVisible && passwordFinal.length < 6) {
      res.status(400).json({ error: "La contraseña tiene que tener al menos 6 caracteres." });
      return;
    }

    const email = loginToEmail(usuario);

    // ¿Ya existe una cuenta de Auth con ese login? (caso: otra persona
    // ya comparte ese mismo usuario, ej. dos con "LOGISTICA")
    let authUserId = null;
    let page = 1;
    while (!authUserId) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const encontrado = data.users.find((u) => u.email.toLowerCase() === email);
      if (encontrado) authUserId = encontrado.id;
      if (data.users.length < 200) break;
      page++;
    }

    let passwordAGuardar = sinPasswordVisible ? passwordFinal : null; // para login manual, no se guarda en la tabla

    if (!authUserId) {
      const { data, error: errCrear } = await supabase.auth.admin.createUser({
        email,
        password: passwordFinal,
        email_confirm: true,
        user_metadata: { usuario, tipo },
      });
      if (errCrear) {
        res.status(500).json({ error: "No se pudo crear la cuenta de Auth: " + errCrear.message });
        return;
      }
      authUserId = data.user.id;
    } else if (sinPasswordVisible) {
      // Ya existía (comparte login con otra persona) -> no generamos
      // una contraseña nueva, hay que reusar la que ya tiene esa cuenta.
      // Como Auth no la puede devolver, la leemos de otra fila que
      // comparta el mismo usuario y ya esté migrada.
      const { data: otraFila } = await supabase
        .from("usuarios")
        .select("password")
        .eq("usuario", usuario)
        .not("auth_user_id", "is", null)
        .limit(1);
      passwordAGuardar = otraFila && otraFila[0] ? otraFila[0].password : passwordFinal;
    }

    const updatePayload = { auth_user_id: authUserId };
    if (passwordAGuardar !== null) updatePayload.password = passwordAGuardar;

    const { error: errUpdate } = await supabase.from("usuarios").update(updatePayload).eq("dni", dni);
    if (errUpdate) {
      res.status(500).json({ error: "La cuenta se creó pero no se pudo enlazar en la tabla: " + errUpdate.message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("crear-usuario-auth error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
};
