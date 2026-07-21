// POST /api/registrar-promo
// Body JSON: { uid }
// Si quedan lugares en la promoción de inauguración (primeras 20 cuentas), activa al vendedor
// sin pasar por Stripe. Si ya no quedan, regresa ok:false para que el cliente siga con el pago normal.
//
// Usa las mismas variables de entorno que verificar-pago.js:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const CUPO_PROMOCION = 20;

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const { uid } = await request.json();
    if (!uid) return jsonResponse({ ok: false, error: "Falta uid." }, 400);

    const accessToken = await obtenerTokenGoogle(env);
    const base = "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents";

    // 1) Leer el contador actual
    let usados = 0;
    const getRes = await fetch(base + "/config/promoVendedores", {
      headers: { "Authorization": "Bearer " + accessToken },
    });
    if (getRes.ok) {
      const doc = await getRes.json();
      usados = (doc.fields && doc.fields.usados && Number(doc.fields.usados.integerValue)) || 0;
    }

    if (usados >= CUPO_PROMOCION) {
      return jsonResponse({ ok: false, agotado: true, restantes: 0 });
    }

    // 2) Incrementar el contador
    const nuevoUsados = usados + 1;
    await fetch(base + "/config/promoVendedores", {
      method: "PATCH",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { usados: { integerValue: String(nuevoUsados) } } }),
    });

    // 3) Activar al vendedor
    await fetch(base + "/vendedores/" + uid, {
      method: "PATCH",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          haPagado: { booleanValue: true },
          promo: { booleanValue: true },
          fechaPago: { integerValue: String(Date.now()) },
        },
      }),
    });

    return jsonResponse({ ok: true, restantes: CUPO_PROMOCION - nuevoUsados });
  } catch (e) {
    return jsonResponse({ ok: false, error: "Error interno: " + e.message }, 500);
  }
}

async function obtenerTokenGoogle(env) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const base64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const base64urlStr = (str) => base64url(encoder.encode(str));

  const unsigned = base64urlStr(JSON.stringify(header)) + "." + base64urlStr(JSON.stringify(claims));

  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const pemBody = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(unsigned));
  const jwt = unsigned + "." + base64url(signature);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("No se pudo obtener token de Google: " + JSON.stringify(tokenData));
  return tokenData.access_token;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
