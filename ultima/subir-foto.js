// POST /api/subir-foto
// Body JSON: { objetoId, indice, dataUrl }
// Guarda la foto en R2 (almacenamiento de archivos, mucho más rápido que Firestore)
// y devuelve la URL pública para mostrarla.
//
// Requiere un binding de R2 llamado FOTOS_BUCKET en la configuración del proyecto de Cloudflare Pages.

const PUBLIC_BASE = "https://pub-00d572d1fa64462c92f0b15bf966d0b3.r2.dev";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const { objetoId, indice, dataUrl } = await request.json();

    if (!objetoId || dataUrl == null || indice == null) {
      return jsonResponse({ ok: false, error: "Faltan datos." }, 400);
    }
    if (!env.FOTOS_BUCKET) {
      return jsonResponse({ ok: false, error: "El almacenamiento de fotos no está configurado." }, 500);
    }

    // dataUrl viene como "data:image/jpeg;base64,...."
    const coma = dataUrl.indexOf(",");
    if (coma === -1) return jsonResponse({ ok: false, error: "Formato de imagen inválido." }, 400);
    const base64 = dataUrl.slice(coma + 1);

    // Convertimos base64 a bytes
    const binaria = atob(base64);
    const bytes = new Uint8Array(binaria.length);
    for (let i = 0; i < binaria.length; i++) bytes[i] = binaria.charCodeAt(i);

    const clave = `objetos/${objetoId}/${indice}.jpg`;
    await env.FOTOS_BUCKET.put(clave, bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });

    return jsonResponse({ ok: true, url: `${PUBLIC_BASE}/${clave}` });
  } catch (e) {
    return jsonResponse({ ok: false, error: "Error interno: " + e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
