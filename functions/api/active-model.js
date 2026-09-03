import { json } from "../../lib/auth.js";

// Public: tells the AR page which model to load. Falls back to the bundled file
// so the demo keeps working before anything has been uploaded, or if D1 is down.
export async function onRequestGet({ env }) {
  const fallback = { url: "./lucky-lantern-cat-mobile.glb", name: "lucky-lantern-cat-mobile.glb", source: "bundled" };
  if (!env.DB) return json(fallback);
  try {
    const row = await env.DB.prepare("SELECT active_model FROM settings WHERE id = 1").first();
    if (!row || !row.active_model) return json(fallback);
    return json({ url: `./models/${row.active_model}`, name: row.active_model, source: "r2" });
  } catch (error) {
    return json(fallback);
  }
}
