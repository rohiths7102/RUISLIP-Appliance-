/**
 * The ONE place that decides a request's client IP.
 *
 * Why this file exists: `x-forwarded-for` is a client-supplied header. Proxies
 * APPEND to it, so the LEFTMOST entry is whatever the caller typed and the
 * RIGHTMOST is the address the closest trusted proxy actually saw. Trusting the
 * leftmost lets anyone defeat every rate limit (and any IP allowlist) by
 * rotating one header — so we never read it.
 *
 * Order of trust:
 *   1. x-vercel-forwarded-for — set by Vercel's edge, cannot be forged upstream
 *   2. cf-connecting-ip       — set by Cloudflare, only when actually behind it
 *   3. RIGHTMOST x-forwarded-for entry — appended by the nearest proxy
 *   4. x-real-ip              — single-value, set by nginx-style proxies
 *
 * TRUST_PROXY_HEADER can pin a specific header when the deployment sits behind
 * a different edge. If nothing is present we return "" — callers treat an
 * unknown IP as its own bucket rather than silently sharing one.
 */
export function clientIpFromHeaders(h: Headers): string {
  // 1) A header the operator has explicitly declared trustworthy.
  const pinned = process.env.TRUST_PROXY_HEADER;
  if (pinned) {
    const v = h.get(pinned);
    if (v) return v.split(",").pop()!.trim();
  }
  // 2) The platform header written by OUR edge. This app deploys to Vercel,
  //    which overwrites x-vercel-forwarded-for on every inbound request, so a
  //    client cannot forge it. cf-connecting-ip is deliberately NOT trusted by
  //    default — nothing here sits behind Cloudflare, so it would just be
  //    another attacker-settable header. Behind Cloudflare, set
  //    TRUST_PROXY_HEADER=cf-connecting-ip.
  const platform = h.get("x-vercel-forwarded-for");
  if (platform) return platform.split(",").pop()!.trim();

  // 3) Raw x-forwarded-for is DELIBERATELY NOT USED. With no trusted proxy in
  //    front, every entry — leftmost or rightmost — is attacker-supplied, so
  //    honouring it would let one caller rotate the header and defeat every
  //    limiter. Set TRUST_PROXY_HEADER=x-forwarded-for only if a proxy you
  //    control rewrites it. Otherwise unknown callers share one bucket, which
  //    still throttles a brute-force attempt rather than waving it through.
  return "";
}

export const clientIpFromRequest = (req: Request): string => clientIpFromHeaders(req.headers);
