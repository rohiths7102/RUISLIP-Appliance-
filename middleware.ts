import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
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
export function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // Crawl log for Admin → Live: a search crawler fetching a page is posted to
  // /api/track/crawl after the response, so it never slows the page down.
  const ua = req.headers.get("user-agent") || "";
  if (req.method === "GET" && /Googlebot|Google-InspectionTool|Storebot-Google|GoogleOther|bingbot/i.test(ua)
      && process.env.SESSION_SECRET && !pathname.startsWith("/api/")) {
    event.waitUntil(fetch(new URL("/api/track/crawl", req.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-crawl-key": process.env.SESSION_SECRET },
      body: JSON.stringify({ path: pathname, ua, ip: clientIpFrom(req.headers) }),
    }).catch(() => {}));
  }

  // The old site linked brands with capitals (/brands/Hotpoint); ours are
  // lowercase and the lookup is exact, so the capitalised form is a 404. A
  // next.config redirect cannot fix it: sources there match case-insensitively,
  // so it would catch its own destination and loop. 301, so Google keeps the
  // lowercase one.
  if (pathname.startsWith("/brands/") && pathname !== pathname.toLowerCase()) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.toLowerCase();
    return NextResponse.redirect(url, 301);
  }

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
