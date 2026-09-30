import { timingSafeEqual } from "node:crypto";

/**
 * Vercel calls every cron route with "Authorization: Bearer $CRON_SECRET";
 * anything else is refused, and so is every call while the secret is unset or
 * too short to be one.
 */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (secret.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
