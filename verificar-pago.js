// GET /api/verificar-pago?session_id=...
// 1) Confirma con Stripe que el pago se completó.
// 2) Si sí, marca vendedores/{uid}.haPagado = true en Firestore usando una cuenta de servicio de Firebase.
//
// Variables de entorno necesarias en Cloudflare (protegidas, nunca en el código):
//   STRIPE_SECRET_KEY
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (el contenido de "private_key" del JSON de la cuenta de servicio, tal cual, con los \n incluidos)

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return jsonResponse({ ok: false, error: "Falta session_id." }, 400);
    }

    // 1) Confirmar el pago con Stripe
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions/" + sessionId, {
      headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY },
    });
    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return jsonResponse({ ok: false, error: "No se pudo verificar la sesión de pago." }, 500);
    }
    if (session.payment_status !== "paid") {
      return jsonResponse({ ok: false, error: "El pago todavía no se ha completado." }, 200);
    }

    const uid = session.metadata && session.metadata.uid;
    if (!uid) {
      return jsonResponse({ ok: false, error: "No se encontró el usuario asociado al pago." }, 500);
    }

    // 2) Obtener un token de acceso de Google usando la cuenta de servicio de Firebase
    const accessToken = await obtenerTokenGoogle(env);

    // 3) Marcar al vendedor como pagado en Firestore
    const firestoreUrl =
      "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID +
      "/databases/(default)/documents/vendedores/" + uid +
      "?updateMask.fieldPaths=haPagado&updateMask.fieldPaths=fechaPago&currentDocument.exists=true";

    let firestoreRes = await fetch(firestoreUrl, {
      method: "PATCH",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          haPagado: { booleanValue: true },
          fechaPago: { integerValue: String(Date.now()) },
        },
      }),
    });

    // Si el documento del vendedor todavía no existe (por ejemplo, si se creó la cuenta pero
    // el guardado inicial falló), lo creamos directamente con PATCH sin exigir que ya exista.
    if (!firestoreRes.ok) {
      const createUrl =
        "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID +
        "/databases/(default)/documents/vendedores/" + uid;
      firestoreRes = await fetch(createUrl, {
        method: "PATCH",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            haPagado: { booleanValue: true },
            fechaPago: { integerValue: String(Date.now()) },
          },
        }),
      });
    }

    if (!firestoreRes.ok) {
      const errTxt = await firestoreRes.text();
      return jsonResponse({ ok: false, error: "No se pudo activar la cuenta: " + errTxt }, 500);
    }

    return jsonResponse({ ok: true });
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

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsigned)
  );

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
  if (!tokenRes.ok) {
    throw new Error("No se pudo obtener token de Google: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
