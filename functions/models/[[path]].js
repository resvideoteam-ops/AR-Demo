// Serves uploaded models straight from R2, with an ETag so repeat visits and the
// service worker revalidate cheaply instead of re-downloading several megabytes.
export async function onRequestGet({ params, env, request }) {
  if (!env.MODELS) return new Response("Model storage is not configured", { status: 500 });

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const name = segments.join("/");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return new Response("Not found", { status: 404 });

  const object = await env.MODELS.get(`models/${name}`);
  if (!object) return new Response("Not found", { status: 404 });

  const etag = object.httpEtag;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "model/gltf-binary",
      "cache-control": "public, max-age=31536000",
      "content-length": String(object.size),
      etag
    }
  });
}
