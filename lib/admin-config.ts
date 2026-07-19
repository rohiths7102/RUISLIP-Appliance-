/**
 * Central config for locking down the admin area. All knobs are env-driven so
 * nothing secret is hard-coded in the repo.
 *
 * ADMIN_PATH           public URL segment for the admin (default "admin").
 *                      Set to a secret like "manage-8f3a2" to move it off /admin.
 *                      NOTE: this is obscurity, not security — it thins out bot
 *                      noise but does not stop a determined attacker. The real
 *                      gate is ADMIN_ALLOWED_IPS below (and, in production,
 *                      Cloudflare Access / SSO). See SECURITY.md.
 *
 * ADMIN_ALLOWED_IPS    comma-separated allowlist. When set, every admin surface
 *                      returns 404 (not 401) to any other IP — so the panel is
 *                      neither reachable nor even discoverable. Accepts exact
 *                      IPs and CIDR-lite prefixes ("203.0.113." matches the /24).
 *                      Leave empty to disable (demo/dev).
 */

export const ADMIN_PATH = (process.env.ADMIN_PATH || "admin").replace(/^\/+|\/+$/g, "");
export const SIGNIN_PATH = `/${ADMIN_PATH}/signin`;
export const usingSecretAdminPath = ADMIN_PATH !== "admin";

/** Build a public admin URL. adminHref() → "/admin", adminHref("products") → "/admin/products". */
export const adminHref = (sub = "") => (sub ? `/${ADMIN_PATH}/${sub.replace(/^\/+/, "")}` : `/${ADMIN_PATH}`);

const ALLOWED = (process.env.ADMIN_ALLOWED_IPS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
export const ipAllowlistActive = ALLOWED.length > 0;

/** Client IP from the proxy chain (Cloudflare tunnel sets cf-connecting-ip). */
export function clientIpFrom(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    ""
  );
}

/** Is this IP on the allowlist? (No allowlist configured → everyone allowed.) */
export function ipAllowed(ip: string): boolean {
  if (!ipAllowlistActive) return true;
  if (!ip) return false;
  return ALLOWED.some((entry) =>
    entry.endsWith(".") || entry.endsWith(":") ? ip.startsWith(entry) : ip === entry
  );
}

/**
 * A callbackUrl is only safe if it's a same-origin path. Reject anything that
 * could bounce the user off-site after login (open-redirect / phishing).
 */
export function safeCallback(raw: string | null | undefined, fallback = `/${ADMIN_PATH}`): string {
  if (!raw) return fallback;
  let v = raw;
  try { v = decodeURIComponent(raw); } catch { return fallback; }
  // must be a rooted path, not "//evil.com", "/\evil", or "https://…"
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /^\/[a-z]+:/i.test(v)) return fallback;
  return v;
}
