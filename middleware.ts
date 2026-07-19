import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PATH, usingSecretAdminPath, ipAllowed, clientIpFrom, ipAllowlistActive } from "@/lib/admin-config";

/**
 * Single choke point for the admin area. Runs before any handler.
 *
 *   1. IP allowlist  — when ADMIN_ALLOWED_IPS is set, every admin surface
 *      (UI + APIs + auth) returns 404 to any other IP. 404, not 401, so a
 *      scanner can't even tell the admin exists.
 *   2. Secret path   — if ADMIN_PATH is customised, the public URL is the secret
 *      segment; it's rewritten to the internal /admin tree, and the default
 *      /admin is 404'd so it can't be used as a backdoor.
 *   3. noindex       — X-Robots-Tag on every admin response, so it can never be
 *      indexed even if a URL leaks.
 *
 * NOTE: full session verification (HMAC/scrypt) stays in the routes/pages — this
 * edge layer is defence in depth, not the only gate.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const onSecret = usingSecretAdminPath && (pathname === `/${ADMIN_PATH}` || pathname.startsWith(`/${ADMIN_PATH}/`));
  const onInternalAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const onAdminApi = pathname.startsWith("/api/admin") || pathname === "/api/auth/login" || pathname === "/api/auth/logout";

  const touchingAdmin = onSecret || onInternalAdmin || onAdminApi;
  if (!touchingAdmin) return NextResponse.next();

  // 1) IP allowlist — 404 anyone not on it
  if (ipAllowlistActive && !ipAllowed(clientIpFrom(req.headers))) {
    return new NextResponse(null, { status: 404 });
  }

  // 2) With a secret path active, the default /admin is a dead end
  if (usingSecretAdminPath && onInternalAdmin) {
    return new NextResponse(null, { status: 404 });
  }

  // Stamp the PUBLIC admin path onto the request so requireAdmin can build a
  // correct post-login callbackUrl regardless of secret-path rewriting.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-admin-path", pathname);

  // 3) Rewrite the secret public path to the internal /admin tree
  if (onSecret) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.replace(`/${ADMIN_PATH}`, "/admin");
    const res = NextResponse.rewrite(url, { request: { headers: reqHeaders } });
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Run on everything except static assets; the function itself filters to admin.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|svg|mp4|ico|txt|xml|json)$).*)"],
};
