# Security posture

Two layers, and it matters which does what.

## Layer 1 — the app (in this repo, always on)

Guarantees the application itself is safe even with **nothing in front of it**:

| Surface | Protection |
|---|---|
| **Admin login** | Moved to **`/admin/signin`** (with safe `callbackUrl` bounce-back; open-redirects rejected). scrypt hashes, timing-safe compare, HMAC-signed httpOnly cookie. **Rate-limited: 8/min + 30/15min per IP** → 429 with `Retry-After`. |
| **Admin discoverability** | Every admin response carries `X-Robots-Tag: noindex, nofollow` (via middleware); robots.txt disallows `/admin`. It can't be indexed even if a URL leaks. |
| **Hide the admin (optional)** | `ADMIN_PATH=<secret>` moves the panel off `/admin` to a secret segment (e.g. `/manage-8f3a2`); the default `/admin` then 404s so it can't be a backdoor. **Obscurity, not security** — thins bot noise, not a real gate. |
| **Lock the admin (real)** | `ADMIN_ALLOWED_IPS=<ip,ip>` — every admin surface (UI + `/api/admin/*` + auth) returns **404** to any other IP, so the panel is neither reachable nor discoverable. This is the true "not publicly available." Middleware enforces it at the edge, before any handler. |
| **Admin write APIs** | Every route auth-gated; most write routes additionally **rate-capped behind auth** (a stolen/forged cookie can't drive machine-speed edits). Caps — and the four still missing one — listed below. |
| **Contact / enquiry form** | 5/min per IP, honeypot field, length caps. |
| **Chatbot** | 20/min per IP; server-side Groq key; prompt grounded only in catalogue. |
| **Analytics beacon** | 60/min per IP, silent 204 over-limit; stores no cookies/IPs/identifiers. |
| **Image upload** | Auth + magic-byte validation (not filename/content-type) + UUID names (no path traversal). |
| **Session** | `SESSION_SECRET` signs cookies; without it, forgery is possible — **it's set in `.env`, keep it.** |

Limiter: `lib/rate-limit.ts` — in-memory fixed-window, per IP+bucket, self-evicting. Proven by `npm run verify:ratelimit` (login/enquiry/chat all flip to 429 on a burst; a normal cadence passes).

> **Per-process caveat:** the in-memory limiter resets on restart and is per-instance. For one shop on one server that's fine. Behind multiple instances, move the counter to Redis/Upstash — the interface in `rate-limit.ts` is the only thing to swap.

> **"Per IP" needs a trusted header.** `lib/client-ip.ts` believes only `TRUST_PROXY_HEADER` (the header your own proxy rewrites) or Vercel's `x-vercel-forwarded-for`; raw `x-forwarded-for` / `cf-connecting-ip` are forgeable and deliberately ignored. With neither present every caller falls into one shared bucket — see `.env.example`.

### Which admin writes are capped

`requireAdminApi()` in `lib/auth.ts` gates auth **and** rate together. Each route counts on its own bucket, per IP per minute, so a dozen ordinary product saves can't 429 an action the owner performs once:

| Route | Per minute |
|---|---:|
| products `POST` · products `PATCH`/`DELETE` · categories `PATCH` · brands `PATCH` · quick-add | 120 |
| bulk edit | 40 |
| CSV import · lead draft | 20 |
| lead send | 15 |
| sync apply | 6 |

**Not capped — auth only.** Four write routes still call bare `getAdmin()`: `POST /api/admin/upload`, `PATCH /api/admin/business`, `PATCH /api/admin/enquiries`, and — the one that matters — `POST /api/admin/rag/rebuild`, which re-indexes the whole catalogue, so it is the cheapest request to make the server do the most work. A valid session can drive all four as fast as it likes. (The read-only admin routes — overview, CSV exports, sync preview, rag status — are auth-only too.)

## Layer 2 — Cloudflare (the edge, you configure it)

**This does NOT come for free just by proxying through Cloudflare.** Putting a site behind Cloudflare gives you DNS, CDN and TLS by default — **bot verification, CAPTCHA/Turnstile, and edge rate-limiting are separate features you must turn on** in the dashboard. What to enable for this site:

1. **Bot Fight Mode** (free) or **Bot Management** — challenges automated traffic before it reaches the app.
2. **Turnstile** (free CAPTCHA) — add it specifically to `/admin/login` and the contact form. It needs a small code change (a widget + a server-side token check in the login/enquiry routes); say the word and I'll wire it — it's ~30 minutes and belongs at both layers, not just the edge.
3. **Rate Limiting Rules** (WAF) — e.g. "more than 10 POSTs to `/api/auth/login` in 1 min from one IP → block 10 min." This is the edge mirror of Layer 1; having both is correct (defence in depth), not redundant.
4. **WAF Managed Rules** — OWASP ruleset for SQLi/XSS patterns.
5. **Always Use HTTPS** + **SSL Full (strict)**.

**Cloudflare Access (Zero Trust) — the true "login page not public" answer.** If you want the admin genuinely invisible to the internet without managing IPs, put `/admin/*` behind **Cloudflare Access**: Cloudflare authenticates the user at the edge (Google/Microsoft/one-time-PIN) *before the request ever reaches this app*. The signin page and every admin route become unreachable to anyone who hasn't passed that check. It's free for small teams, needs no code change, and composes with Layer 1. This is what I'd recommend for production over a secret URL.

**Bottom line:** the app is safe on its own (Layer 1 is real and tested — `ADMIN_ALLOWED_IPS` already makes the admin 404 to everyone but you). Cloudflare adds the outer wall — but you have to switch on Access / Turnstile / Bot Fight / rate-limit rules; they are not automatic.

## Before the client demo

1. **Set a real admin password** — `node scripts/hash-password.mjs "…"` → `.env`, restart. (Red banner nags until you do.)
2. **Rotate the Groq key.**
3. If the tunnel/URL is public, turn on Cloudflare **Bot Fight Mode** + a login **rate-limit rule** (and ideally Turnstile) as above.

Run `npm run verify:all` to re-prove every layer-1 control.
