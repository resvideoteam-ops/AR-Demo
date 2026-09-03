import { constantTimeEquals, createSession, sessionCookie, clearCookie, json } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Admin login is not configured on the server" }, 500);
  }
  let password = "";
  try {
    ({ password = "" } = await request.json());
  } catch (error) {
    return json({ error: "Malformed request" }, 400);
  }
  if (!(await constantTimeEquals(password, env.ADMIN_PASSWORD))) {
    // Blunt the brute-force rate a little without holding per-IP state.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return json({ error: "Incorrect password" }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(await createSession(env.SESSION_SECRET)) });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
