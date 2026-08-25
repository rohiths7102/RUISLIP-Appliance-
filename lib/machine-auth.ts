import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Authentication for MACHINE callers (n8n, the price collector, a supplier
 * feed). Deliberately NOT the admin session: middleware.ts guards /admin and
 * /api/admin behind an IP allowlist, and a scheduled worker has no stable IP
 * and no browser cookie. So /api/price-ingest/* sits outside that gate and
 * proves itself with a signed request instead.
 *
 * Scheme (see the route files for the wire contract):
 *   x-pw-key        keyId, e.g. "collector"
 *   x-pw-timestamp  unix SECONDS, as a decimal string
 *   x-pw-signature  lowercase hex HMAC-SHA256 over `${route}.${timestamp}.${rawBody}`
 *
 * Signing the route and timestamp together with the body narrows a captured
 * request hard: a body tweak invalidates it, it is only accepted inside a
 * 5-minute window, and it is valid ONLY at the endpoint it was minted for.
 * Verbatim replay within that window is still possible — there is no nonce
 * store — so the window is deliberately short.
 */

export type MachineKey = { keyId: string; secret: string; allowedRoutes: string[]; allowedSources: string[] };

export type MachineAuthResult =
  | { ok: true; keyId: string }
  | { ok: false; status: number; error: string };

/** How far a request's timestamp may be from our clock. Also the replay window. */
export const REPLAY_WINDOW_SECONDS = 300;

/**
 * Which key may call which route. A key is not a bearer of everything: the
 * collector scrapes competitor listings and may only ever WRITE observations
 * and READ its worklist; the supplier feed may additionally post trade prices.
 * Route names are the short names passed to verifyMachineRequest, not paths, so
 * renaming a URL cannot silently widen a key's reach.
 *
 * A key is ALSO scoped to the sources it may write. Route scoping alone is not
 * enough: sourceId arrives in the request body, so a collector key restricted to
 * "observations" could otherwise file its scraped numbers against an
 * `authorised` source and inherit that source's right to move prices. The two
 * guards that carry the whole "only our distributor may set a price" rule
 * (advisory_source, source_auto_apply_disabled) read the SOURCE, not the key —
 * so the key must not be able to choose its source freely.
 */
const ROUTE_GRANTS: Record<string, { routes: string[]; sources: string[] }> = {
  collector: { routes: ["worklist", "observations", "auto-apply"], sources: ["euronics", "google-benchmark", "manufacturer-rrp"] },
  supplier: { routes: ["observations", "supplier-prices"], sources: ["cih"] },
  // The owner relaying a price from WhatsApp. This key carries HUMAN authority —
  // it is the only machine key that may set Product.priceNow — so it is scoped
  // to that one route, holds its own secret, and its route requires an explicit
  // second confirm call. It writes no observations, hence no sources.
  owner: { routes: ["owner-update"], sources: [] },
};

/** PRICE_INGEST_SECRET_COLLECTOR for keyId "collector". */
export function secretEnvNameFor(keyId: string): string {
  return `PRICE_INGEST_SECRET_${keyId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Resolve a keyId to its declared routes and its per-key secret.
 *
 * There is NO shared fallback secret and no default-allow: an unknown keyId, or
 * a known keyId whose env secret is absent/blank, resolves to null and the
 * request is rejected. A missing secret must fail closed — the alternative
 * (treating "no secret configured" as "no check needed") turns a deploy that
 * forgot an env var into an open write endpoint.
 */
export function loadMachineKey(keyId: string): MachineKey | null {
  const grant = ROUTE_GRANTS[keyId];
  if (!grant) return null;
  const secret = (process.env[secretEnvNameFor(keyId)] || "").trim();
  if (!secret) return null;
  return { keyId, secret, allowedRoutes: grant.routes, allowedSources: grant.sources };
}

/**
 * May this key file observations against this source? Fails closed on an
 * unknown key. Call AFTER signature verification, once sourceId is parsed.
 */
export function keyMaySourceWrite(keyId: string, sourceId: string): boolean {
  const key = loadMachineKey(keyId);
  return !!key && key.allowedSources.includes(sourceId);
}

/**
 * The exact string that gets signed. Exported so a signing client can mirror it.
 *
 * The ROUTE is part of the payload. Without it, one captured signature is valid
 * against every route the key is granted for the length of the replay window —
 * so a captured `observations` signature could be replayed at `supplier-prices`.
 * Binding the route means a signature is only ever good for the endpoint it was
 * minted for.
 */
export function signingPayload(route: string, timestamp: string, rawBody: string): string {
  return `${route}.${timestamp}.${rawBody}`;
}

/** Hex HMAC-SHA256 of `${route}.${timestamp}.${rawBody}` — the x-pw-signature value. */
export function signMachineRequest(secret: string, route: string, timestamp: string | number, rawBody: string): string {
  return createHmac("sha256", secret).update(signingPayload(route, String(timestamp), rawBody)).digest("hex");
}

/** Length-safe constant-time hex compare. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false; // both are fixed-width sha256 hex; length is not a secret
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify a machine request.
 *
 * `rawBody` must be the EXACT bytes the caller signed — read it with
 * readRawBody() and parse afterwards. Calling req.json() first consumes the
 * stream and re-serialising the parsed object will not reproduce the caller's
 * whitespace or key order, so the signature would never match.
 *
 * Checked in order: headers present -> timestamp fresh -> signature valid ->
 * route granted. The route check is LAST and returns 403 rather than 401: a
 * valid signature from the wrong key is an authenticated caller exceeding its
 * scope, which is a different (and more alarming) event than a forged request.
 */
export function verifyMachineRequest(req: Request, rawBody: string, route: string): MachineAuthResult {
  const keyId = (req.headers.get("x-pw-key") || "").trim();
  const timestamp = (req.headers.get("x-pw-timestamp") || "").trim();
  const signature = (req.headers.get("x-pw-signature") || "").trim().toLowerCase();

  if (!keyId || !timestamp || !signature) {
    return { ok: false, status: 401, error: "Missing x-pw-key, x-pw-timestamp or x-pw-signature" };
  }
  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, status: 401, error: "Malformed signature" };
  }

  const ts = Number(timestamp);
  if (!/^\d{1,15}$/.test(timestamp) || !Number.isFinite(ts)) {
    return { ok: false, status: 401, error: "Malformed timestamp (expected unix seconds)" };
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > REPLAY_WINDOW_SECONDS) {
    return { ok: false, status: 401, error: `Timestamp outside ${REPLAY_WINDOW_SECONDS}s window` };
  }

  const key = loadMachineKey(keyId);
  // Unknown key and bad signature return the SAME message on purpose — a caller
  // probing key names must not be able to tell "no such key" from "wrong secret".
  const denied: MachineAuthResult = { ok: false, status: 401, error: "Invalid key or signature" };
  if (!key) return denied;
  if (!hexEquals(signMachineRequest(key.secret, route, timestamp, rawBody), signature)) return denied;

  if (!key.allowedRoutes.includes(route)) {
    return { ok: false, status: 403, error: `Key "${keyId}" is not permitted on route "${route}"` };
  }

  return { ok: true, keyId };
}

/**
 * Read the request body as the raw string that was signed. Always call this
 * BEFORE any parsing — a Request body may only be consumed once.
 */
export async function readRawBody(req: Request): Promise<string> {
  try {
    return await req.text();
  } catch {
    return "";
  }
}
