import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const COOKIE_NAME = "admin_session";

/**
 * Session-signing key. The dev fallback is a PUBLIC string in this repo — with
 * it, anyone could mint a valid admin cookie. In production we refuse to fall
 * back: a deployment missing SESSION_SECRET (and ADMIN_PASSWORD_HASH) fails
 * loudly at boot instead of silently signing with a known key.
 */
const DEV_FALLBACK_SECRET = "dev-insecure-secret-change-me";
const SECRET = (() => {
  const configured = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD_HASH;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (or ADMIN_PASSWORD_HASH) must be set in production — refusing to sign sessions with the public dev key.");
  }
  return DEV_FALLBACK_SECRET;
})();

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64); const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function unsign(token: string): any | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const s = Buffer.from(sig), e = Buffer.from(expect);
  if (s.length !== e.length || !crypto.timingSafeEqual(s, e)) return null;
  // An expiry is mandatory — a token without one would never age out.
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p?.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
export const createToken = (email: string) => sign({ email, exp: Math.floor(Date.now() / 1000) + 7 * 86400 });
export const usingDevPassword = () => !process.env.ADMIN_PASSWORD_HASH;

export function checkCredentials(email: string, pw: string): boolean {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@local";
  if (email.trim().toLowerCase() !== adminEmail.toLowerCase()) return false;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  return hash ? verifyPassword(pw, hash) : pw === "admin"; // DEV default; set ADMIN_PASSWORD_HASH for production
}
export async function getAdmin(): Promise<{ email: string } | null> {
  const c = (await cookies()).get(COOKIE_NAME)?.value;
  const p = c ? unsign(c) : null;
  return p ? { email: p.email } : null;
}
export async function requireAdmin(): Promise<{ email: string }> {
  const a = await getAdmin();
  if (!a) {
    // Send them to sign-in and bounce back afterwards. Middleware stamps the
    // public path onto the request as x-admin-path (works whether the panel is at
    // /admin or behind a secret ADMIN_PATH).
    const { SIGNIN_PATH } = await import("./admin-config");
    const { headers } = await import("next/headers");
    const publicPath = (await headers()).get("x-admin-path") || "";
    redirect(publicPath.startsWith("/") ? `${SIGNIN_PATH}?callbackUrl=${encodeURIComponent(publicPath)}` : SIGNIN_PATH);
  }
  return a as { email: string };
}

/**
 * Auth + write-rate gate for admin mutation routes. Returns the admin on success,
 * or a Response (401 / 429) to return immediately. A valid session is still
 * capped, so a stolen or forged cookie can't drive bulk edits/deletes at machine
 * speed. Imported lazily to keep this module edge-safe.
 */
export async function requireAdminApi(
  req: Request,
  opts: { limit?: number; windowMs?: number; bucket?: string } = {}
): Promise<{ admin: { email: string } } | { response: Response }> {
  const admin = await getAdmin();
  if (!admin) return { response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  const { rateLimit, clientIp, tooMany } = await import("./rate-limit");
  // Each route counts on its OWN bucket. Sharing one meant a route's ceiling was
  // measured against every other route's traffic: a dozen ordinary product saves
  // (own limit 120) would 429 the Send button (limit 15) or Apply sync (limit 6),
  // for an action the owner had performed once.
  const gate = rateLimit(`admin-write:${opts.bucket ?? routeBucket(req)}`, clientIp(req), opts.limit ?? 120, opts.windowMs ?? 60_000);
  if (!gate.ok) return { response: tooMany(gate.retryAfter, "Slow down — too many changes at once.") };
  return { admin };
}

/** Route identity for rate-limit bucketing: the pathname with record ids folded
 *  away, so every edit to /api/admin/products/<id> shares one counter rather
 *  than getting a fresh allowance per product. */
function routeBucket(req: Request): string {
  try {
    return new URL(req.url).pathname.replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:id");
  } catch {
    return "unknown";
  }
}
