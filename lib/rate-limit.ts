/**
 * In-memory fixed-window rate limiter, keyed by IP + bucket name.
 *
 * Right-sized for a single-instance shop site (no Redis). It survives bursts and
 * is self-bounding (evicts stale keys), but it is per-process — behind multiple
 * instances or at real scale, put Cloudflare / a WAF in front (see SECURITY.md).
 * That's defence in depth, not a substitute: this guarantees the app itself never
 * lets a bot hammer login or the forms even if nothing sits in front of it.
 */
type Hit = { count: number; resetAt: number };
const store = new Map<string, Hit>();
let lastSweep = 0;

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number; // seconds until the window resets
}

/** Best-effort client IP from proxy headers, falling back to a constant. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "local";
}

export function rateLimit(bucket: string, ip: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();

  // periodic eviction so the map can't grow unbounded
  if (now - lastSweep > 60_000) {
    for (const [k, v] of store) if (v.resetAt < now) store.delete(k);
    lastSweep = now;
  }

  const key = `${bucket}:${ip}`;
  const hit = store.get(key);
  if (!hit || hit.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  hit.count++;
  if (hit.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((hit.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - hit.count, retryAfter: 0 };
}

/** Standard 429 with a Retry-After header. */
export function tooMany(retryAfter: number, message = "Too many attempts — please wait a moment and try again.") {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}
