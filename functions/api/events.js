import { json } from "../../lib/auth.js";

// Events the AR page is allowed to report. Anything else is dropped, so a
// stray or hostile client cannot fill the table with arbitrary strings.
const ALLOWED = new Set([
  "session_start", "camera_started", "marker_found", "marker_lost",
  "model_loaded", "model_error", "photo_captured", "photo_saved"
]);

const clean = (value, max) =>
  typeof value === "string" && value.length ? value.slice(0, max) : null;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Analytics storage is not configured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: "Malformed request" }, 400);
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const sessionId = clean(body.session_id, 40);
  if (!sessionId || !events.length) return json({ error: "Nothing to record" }, 400);

  // Coarse, non-identifying context only: no IP address, no user agent string.
  const country = clean(request.headers.get("cf-ipcountry"), 2);
  const device = clean(body.device, 16);

  const rows = events
    .filter((entry) => entry && ALLOWED.has(entry.event))
    .map((entry) =>
      env.DB.prepare(
        "INSERT INTO events (event, session_id, model, device, country) VALUES (?, ?, ?, ?, ?)"
      ).bind(entry.event, sessionId, clean(entry.model, 120), device, country)
    );

  if (!rows.length) return json({ error: "No recognised events" }, 400);

  try {
    await env.DB.batch(rows);
  } catch (error) {
    return json({ error: "Could not record events" }, 500);
  }
  return json({ ok: true, recorded: rows.length });
}
