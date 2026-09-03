import { requireAdmin, json } from "../../lib/auth.js";

const MAX_BYTES = 30 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;

// glTF binary files begin with the ASCII magic "glTF". Checking the bytes stops
// a mislabelled or hostile upload from being stored as a model.
async function isGlb(buffer) {
  const head = new Uint8Array(buffer.slice(0, 4));
  return head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.MODELS) return json({ error: "Model storage is not configured" }, 500);

  const listing = await env.MODELS.list({ prefix: "models/" });
  const active = env.DB
    ? (await env.DB.prepare("SELECT active_model FROM settings WHERE id = 1").first())?.active_model
    : null;

  return json({
    active: active || null,
    models: listing.objects.map((object) => ({
      name: object.key.replace(/^models\//, ""),
      size: object.size,
      uploaded: object.uploaded
    }))
  });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.MODELS) return json({ error: "Model storage is not configured" }, 500);

  let form;
  try {
    form = await request.formData();
  } catch (error) {
    return json({ error: "Malformed upload" }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "No file supplied" }, 400);

  const name = (form.get("name") || file.name || "").toString().trim().replace(/\s+/g, "-");
  if (!SAFE_NAME.test(name) || !name.toLowerCase().endsWith(".glb")) {
    return json({ error: "Name must be letters, numbers, dot, dash or underscore and end in .glb" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: `File is ${(file.size / 1048576).toFixed(1)} MB; the limit is 30 MB` }, 413);
  }

  const buffer = await file.arrayBuffer();
  if (!(await isGlb(buffer))) return json({ error: "That file is not a binary glTF (.glb)" }, 400);

  await env.MODELS.put(`models/${name}`, buffer, {
    httpMetadata: { contentType: "model/gltf-binary", cacheControl: "public, max-age=31536000" }
  });

  if (form.get("activate") === "true" && env.DB) {
    await env.DB.prepare("UPDATE settings SET active_model = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(name).run();
  }
  return json({ ok: true, name, size: file.size });
}

export async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: "Database is not configured" }, 500);

  let name;
  try {
    ({ name } = await request.json());
  } catch (error) {
    return json({ error: "Malformed request" }, 400);
  }
  if (!SAFE_NAME.test(name || "")) return json({ error: "Invalid model name" }, 400);
  if (env.MODELS && !(await env.MODELS.head(`models/${name}`))) {
    return json({ error: "That model is not in storage" }, 404);
  }
  await env.DB.prepare("UPDATE settings SET active_model = ?, updated_at = datetime('now') WHERE id = 1")
    .bind(name).run();
  return json({ ok: true, active: name });
}

export async function onRequestDelete({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const name = new URL(request.url).searchParams.get("name") || "";
  if (!SAFE_NAME.test(name)) return json({ error: "Invalid model name" }, 400);

  const active = env.DB
    ? (await env.DB.prepare("SELECT active_model FROM settings WHERE id = 1").first())?.active_model
    : null;
  if (active === name) return json({ error: "That model is live; activate another one first" }, 409);

  await env.MODELS.delete(`models/${name}`);
  return json({ ok: true });
}
