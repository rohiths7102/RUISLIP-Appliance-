/**
 * The ONE place that decides a request's client IP.
 *
 * Why this file exists: `x-forwarded-for` is a client-supplied header. Proxies
 * APPEND to it, so the LEFTMOST entry is whatever the caller typed and the
 * RIGHTMOST is the address the closest trusted proxy actually saw. With no
 * proxy WE control in front, every entry — either end — is attacker-supplied,
 * so we never read it: rotating a header must never defeat a rate limit or walk
 * past the admin IP allowlist.
 *
 * Exactly two sources are trusted, in this order — nothing else is read:
 *   1. TRUST_PROXY_HEADER — the header the operator has declared their own edge
 *      rewrites (rightmost value). This is the ONLY way x-forwarded-for,
 *      x-real-ip or cf-connecting-ip ever gets believed.
 *   2. x-vercel-forwarded-for — overwritten by Vercel's edge on every inbound
 *      request, so a client cannot forge it. This app's production host.
 *
 * Anywhere else — local :3005, docker, nginx, a Cloudflare tunnel — neither is
 * present and every caller collapses into UNKNOWN_IP below, so such a
 * deployment MUST set TRUST_PROXY_HEADER to the header its proxy rewrites.
 */

/**
 * No trusted header identified the caller. Callers must read this as "unknown",
 * never as an identity, and both of ours deliberately do the safe thing:
 *   - lib/rate-limit puts every unknown caller in ONE shared bucket, so the
 *     enquiry form's "5 per minute" becomes 5 per minute site-wide and a stranger
 *     can trip the login lockout that guards the owner's own sign-in. A shared
 *     bucket still throttles a brute-force attempt where honouring a forgeable
 *     header would wave it through — but it is a fallback, not a posture to run in.
 *   - lib/admin-config fails CLOSED: an unknown IP is never on the allowlist.
 */
export const UNKNOWN_IP = "";

// Said once per process, because a deployment in this state throttles all of its
// visitors as though they were one person and nothing else in the app can tell.
let warnedNoTrustedHeader = false;

export function clientIpFromHeaders(h: Headers): string {
  // 1) A header the operator has explicitly declared trustworthy. Rightmost
  //    value: their proxy appended that one, anything left of it came from the
  //    caller.
  const pinned = process.env.TRUST_PROXY_HEADER;
  if (pinned) {
    const v = h.get(pinned);
    if (v) return v.split(",").pop()!.trim();
  }
  // 2) The platform header written by OUR edge. This app deploys to Vercel,
  //    which overwrites x-vercel-forwarded-for on every inbound request, so a
  //    client cannot forge it.
  const platform = h.get("x-vercel-forwarded-for");
  if (platform) return platform.split(",").pop()!.trim();

  // 3) Raw x-forwarded-for, x-real-ip and cf-connecting-ip are DELIBERATELY NOT
  //    READ. With no trusted proxy in front, every entry — leftmost or rightmost
  //    — is attacker-supplied, so honouring one would let a caller rotate the
  //    header and defeat every limiter. Opting in is the operator's call, via
  //    TRUST_PROXY_HEADER, and only for a proxy they control.
  if (!warnedNoTrustedHeader) {
    warnedNoTrustedHeader = true;
    console.warn(
      "[client-ip] No trusted client-IP header on this request" +
        (pinned ? ` (TRUST_PROXY_HEADER=${pinned} is set but absent)` : " (not on Vercel, TRUST_PROXY_HEADER unset)") +
        ". Every caller now shares one rate-limit bucket and the admin IP allowlist can never match." +
        " Set TRUST_PROXY_HEADER to the header your proxy rewrites — x-forwarded-for behind your own nginx, cf-connecting-ip behind Cloudflare.",
    );
  }
  return UNKNOWN_IP;
}

export const clientIpFromRequest = (req: Request): string => clientIpFromHeaders(req.headers);
