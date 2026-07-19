import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const COOKIE_NAME = "admin_session";
const SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD_HASH || "dev-insecure-secret-change-me";

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
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); if (p.exp && p.exp < Date.now() / 1000) return null; return p; } catch { return null; }
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
  opts: { limit?: number; windowMs?: number } = {}
): Promise<{ admin: { email: string } } | { response: Response }> {
  const admin = await getAdmin();
  if (!admin) return { response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  const { rateLimit, clientIp, tooMany } = await import("./rate-limit");
  const gate = rateLimit("admin-write", clientIp(req), opts.limit ?? 120, opts.windowMs ?? 60_000);
  if (!gate.ok) return { response: tooMany(gate.retryAfter, "Slow down — too many changes at once.") };
  return { admin };
}
