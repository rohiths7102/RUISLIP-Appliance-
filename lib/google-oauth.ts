import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SITE } from "@/lib/seo";

/**
 * The owner's one "Connect Google" sign-in, shared by the Google Ads API and
 * Search Console. Needs a Google Cloud OAuth client (Web application) with the
 * redirect URI `${site}/api/admin/google/callback`:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 * The refresh token Google returns is stored encrypted (GoogleConnection).
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "openid", "email",
];

export const oauthConfigured = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
export const redirectUri = () => `${SITE().replace(/\/+$/, "")}/api/admin/google/callback`;

export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", redirect_uri: redirectUri(), response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "", ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || r.status}`);
  return j;
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() }) as Promise<{ refresh_token?: string; access_token: string; scope: string; id_token?: string }>;

/* ---------- the stored refresh token, encrypted at rest ---------- */

function key(): Buffer {
  const base = process.env.GOOGLE_TOKEN_KEY || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD_HASH;
  if (!base && process.env.NODE_ENV === "production") throw new Error("GOOGLE_TOKEN_KEY or SESSION_SECRET must be set");
  return createHash("sha256").update(`google-token:${base || "dev-only"}`).digest();
}
export function encrypt(text: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
function decrypt(blob: string): string {
  const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

/** A fresh access token from the stored sign-in, or null if the owner hasn't connected Google. */
let cached: { token: string; until: number } | null = null;
export async function accessToken(db: any): Promise<string | null> {
  if (cached && cached.until > Date.now()) return cached.token;
  const conn = await db.googleConnection.findUnique({ where: { id: "google" } }).catch(() => null);
  if (!conn || !oauthConfigured()) return null;
  const j = await tokenRequest({ refresh_token: decrypt(conn.refreshToken), grant_type: "refresh_token" });
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3000) * 1000 - 60_000 };
  return cached.token;
}
export const forgetAccessToken = () => { cached = null; };

/** The signed-in Google account's email, from the id_token Google returned. */
export function emailFromIdToken(idToken?: string): string {
  try { return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString()).email || ""; } catch { return ""; }
}
