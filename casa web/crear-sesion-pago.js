// POST /api/crear-sesion-pago
// Body JSON: { uid, correo }
// Crea una sesión de pago de Stripe Checkout para el "Pack de lanzamiento".
// La llave secreta de Stripe vive como variable de entorno protegida en Cloudflare (STRIPE_SECRET_KEY),
// nunca en el código ni visible en el navegador.

const PRICE_ID = "price_1TvKFnQ7oKoZFCqKgkDHrDFq";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
    const { uid, correo } = body || {};

    if (!uid || !correo) {
      return jsonResponse({ error: "Falta uid o correo." }, 400);
    }

    const origin = new URL(request.url).origin;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[0]", "card");
    params.append("line_items[0][price]", PRICE_ID);
    params.append("line_items[0][quantity]", "1");
    params.append("customer_email", correo);
    params.append("metadata[uid]", uid);
    params.append("success_url", origin + "/pago-exitoso.html?session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", origin + "/pago-cancelado.html");

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return jsonResponse({ error: session.error ? session.error.message : "Error de Stripe." }, 500);
    }

    return jsonResponse({ url: session.url });
  } catch (e) {
    return jsonResponse({ error: "Error interno: " + e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
