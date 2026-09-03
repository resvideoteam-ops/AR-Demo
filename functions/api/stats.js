import { requireAdmin, json } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: "Analytics storage is not configured" }, 500);

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const since = `-${days} days`;

  const query = (sql) => env.DB.prepare(sql).bind(since).all();

  try {
    const [totals, daily, countries, devices, sessions, models] = await Promise.all([
      query(`SELECT event, COUNT(*) AS count FROM events
             WHERE created_at >= datetime('now', ?) GROUP BY event ORDER BY count DESC`),
      query(`SELECT date(created_at) AS day,
                    COUNT(DISTINCT session_id) AS sessions,
                    SUM(CASE WHEN event = 'marker_found'   THEN 1 ELSE 0 END) AS marker_found,
                    SUM(CASE WHEN event = 'photo_captured' THEN 1 ELSE 0 END) AS photos
             FROM events WHERE created_at >= datetime('now', ?)
             GROUP BY day ORDER BY day`),
      query(`SELECT COALESCE(country, '??') AS country, COUNT(DISTINCT session_id) AS sessions
             FROM events WHERE created_at >= datetime('now', ?)
             GROUP BY country ORDER BY sessions DESC LIMIT 20`),
      query(`SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT session_id) AS sessions
             FROM events WHERE created_at >= datetime('now', ?) GROUP BY device ORDER BY sessions DESC`),
      query(`SELECT COUNT(DISTINCT session_id) AS sessions FROM events
             WHERE created_at >= datetime('now', ?)`),
      query(`SELECT COALESCE(model, 'unknown') AS model, COUNT(*) AS loads FROM events
             WHERE event = 'model_loaded' AND created_at >= datetime('now', ?)
             GROUP BY model ORDER BY loads DESC LIMIT 20`)
    ]);

    const byEvent = Object.fromEntries(totals.results.map((row) => [row.event, row.count]));
    const totalSessions = sessions.results[0]?.sessions || 0;
    const reached = (key) => byEvent[key] || 0;

    return json({
      days,
      sessions: totalSessions,
      totals: byEvent,
      // How far visitors get: opened -> pointed camera -> locked marker -> took a photo.
      funnel: {
        sessions: totalSessions,
        camera_started: reached("camera_started"),
        marker_found: reached("marker_found"),
        photo_captured: reached("photo_captured")
      },
      daily: daily.results,
      countries: countries.results,
      devices: devices.results,
      models: models.results
    });
  } catch (error) {
    return json({ error: "Could not read analytics" }, 500);
  }
}
