// Session auth for the admin routes.
//
// The password itself is never stored here or in the repo: it lives only in a
// Cloudflare secret you set yourself (ADMIN_PASSWORD). Login compares against it
// in constant time and hands back a short-lived HMAC-signed cookie, so the
// password is not replayed on every request.

const COOKIE = "ar_admin";
const TTL_SECONDS = 60 * 60 * 8;

const encoder = new TextEncoder();

function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

// Length-independent comparison. Hashing both sides first means an attacker
// cannot learn the password length from timing either.
export async function constantTimeEquals(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(a))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(b)))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function createSession(secret) {
  const payload = b64urlEncode(encoder.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS
  })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${b64urlEncode(signature)}`;
}

export async function verifySession(token, secret) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC", await hmacKey(secret), b64urlDecode(parts[1]), encoder.encode(parts[0])
    );
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

// Guard for every admin route. Returns null when the caller is authorised.
export async function requireAdmin(request, env) {
  if (!env.SESSION_SECRET) return json({ error: "SESSION_SECRET is not configured" }, 500);
  const ok = await verifySession(readCookie(request), env.SESSION_SECRET);
  return ok ? null : json({ error: "Not authorised" }, 401);
}
