/**
 * "Scrape a page" — the owner pastes a product URL, we read the page on his
 * behalf and tell him what we found; a second call creates or updates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE IS AN SSRF SINK.
 * It makes the SERVER fetch a URL chosen by the caller. On a hosted platform the
 * server sits inside a private network next to the database, the metadata
 * service (169.254.169.254) and any internal admin ports — all of which are
 * reachable from there and from nowhere else. So every URL, and every redirect
 * hop, is validated before a socket is opened:
 *
 *   1. https only (no http, file:, gopher:, data:, ftp: …)
 *   2. no credentials in the URL (https://user:pass@host — some fetchers leak them)
 *   3. port must be the default 443 — no probing 127.0.0.1:5432-style internals
 *   4. hostname must be a real public name: has a dot, is not `localhost`, and
 *      does not end in .local / .internal / .localdomain / .home.arpa / .lan
 *   5. EVERY resolved address (A + AAAA, and IP literals) must be public —
 *      loopback, private, link-local, CGNAT, multicast, reserved and the
 *      IPv4-mapped / 6to4 / NAT64 v6 forms that smuggle a v4 address are refused
 *   6. redirects are followed MANUALLY (redirect: "manual"), max 3 hops, and
 *      every hop goes back through 1-5 — a public URL that 302s to
 *      http://169.254.169.254/ is the classic bypass
 *   7. 15s deadline across all hops, and the body is read in chunks and abandoned
 *      past 3MB so a hostile/huge page cannot exhaust server memory
 *   8. only HTML content types are read
 *
 * Residual risk, stated honestly: between our DNS check and fetch's own
 * resolution a name could be re-pointed at a private address (DNS rebinding).
 * Closing that needs connection-level pinning; the checks above plus the
 * admin-session + rate-limit gate are the mitigation we have here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { revalidateStorefront } from "@/lib/revalidate";
import { EDITABLE, coerce, slugify, reconcileSaving, ValidationError } from "@/lib/admin-product";
import { ensureBrand, recomputeCounts } from "@/lib/counts";
import { syncProductToRag } from "@/lib/rag/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_REDIRECTS = 3;
const UA = "JyotsnaElectricalBot/1.0 (+admin product lookup; contact rohith@kroneuszerotrust.com)";

/* ══════════════════════════════════════════════════ URL / SSRF validation ══ */

/** A caller-facing failure that is safe to print verbatim. Never a stack. */
class LookupError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const BAD_SUFFIX = [".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".localhost"];

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0) return true;                          // 0.0.0.0/8 "this network"
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local — AWS/GCP/Azure metadata lives at 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;  // IETF protocol assignments + TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;             // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true;           // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;            // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;             // TEST-NET-3
  if (a >= 224) return true;                         // multicast 224/4 + reserved 240/4 + broadcast
  return false;
}

function ipv6Blocked(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (ip === "::" || ip === "::1") return true;             // unspecified + loopback
  // IPv4-mapped written in hex rather than dotted quad: ::ffff:7f00:1 IS 127.0.0.1.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16), lo = parseInt(hexMapped[2], 16);
    return ipv4Blocked([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  }
  // Everything else in ::/64 (::a.b.c.d, ::abc, IPv4-compatible) is special-use, never a public host.
  if (ip.startsWith("::") && !ip.startsWith("::ffff:")) return true;
  // IPv4 smuggled inside a v6 address: ::ffff:a.b.c.d, 64:ff9b::a.b.c.d (NAT64)
  const embedded = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return ipv4Blocked(embedded[1]);
  // 2002:xxyy:zzww::/16 — 6to4 wraps a v4 address in the first two groups
  const sixToFour = ip.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1].padStart(4, "0"), 16);
    const lo = parseInt(sixToFour[2].padStart(4, "0"), 16);
    return ipv4Blocked([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  }
  const head = parseInt(ip.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

const addressBlocked = (ip: string) => (isIP(ip) === 6 ? ipv6Blocked(ip) : ipv4Blocked(ip));

/** Parse + fully validate one URL (including DNS). Throws LookupError. */
async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw.trim()); }
  catch { throw new LookupError("That doesn't look like a web address. Paste the full link, starting with https://"); }

  if (u.protocol !== "https:") throw new LookupError("Only https:// addresses can be read. Copy the link from your browser's address bar.");
  if (u.username || u.password) throw new LookupError("That link contains a username or password. Paste the plain product link instead.");
  if (u.port && u.port !== "443") throw new LookupError("That link points at an unusual port, so it isn't a normal public web page.");

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new LookupError("That web address has no website name in it.");

  const literal = isIP(host.replace(/^\[|\]$/g, ""));
  if (literal) {
    if (addressBlocked(host.replace(/^\[|\]$/g, ""))) throw new LookupError("That address is on a private or internal network, so it can't be read.");
    return u;
  }

  if (host === "localhost" || !host.includes(".") || BAD_SUFFIX.some((s) => host.endsWith(s))) {
    throw new LookupError("That address is on a private or internal network, so it can't be read.");
  }

  let addresses: { address: string }[];
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new LookupError(`We couldn't find a website at "${host}". Check the address and try again.`); }

  if (!addresses.length) throw new LookupError(`We couldn't find a website at "${host}". Check the address and try again.`);
  // ALL of them — a name that returns one public and one private address must fail.
  if (addresses.some((a) => addressBlocked(a.address))) {
    throw new LookupError("That address is on a private or internal network, so it can't be read.");
  }
  return u;
}

/* ═════════════════════════════════════════════════════════════ safe fetch ══ */

/**
 * Read the body in chunks and STOP at MAX_BYTES. `await res.text()` would buffer
 * whatever the far end sends — a 5GB response, or an endless stream, would take
 * the server down with it.
 */
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (kept + value.byteLength > MAX_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    kept += value.byteLength;
  }
  const merged = new Uint8Array(kept);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.byteLength; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

/** Fetch a page, validating the URL and every redirect hop. */
async function fetchPage(raw: string): Promise<{ html: string; finalUrl: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = await assertPublicHttpsUrl(current); // re-validated on EVERY hop
      let res: Response;
      try {
        res = await fetch(u.toString(), {
          redirect: "manual",
          signal: controller.signal,
          cache: "no-store",
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.9" },
        });
      } catch (e: any) {
        if (e?.name === "AbortError") throw new LookupError("That page took too long to answer (over 15 seconds). Try again, or add the product by hand.", 504);
        throw new LookupError("We couldn't reach that page. Check the link is right and that the site is up.", 502);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new LookupError("That page redirected us somewhere we couldn't follow.", 502);
        if (hop === MAX_REDIRECTS) throw new LookupError("That link redirects too many times.", 502);
        current = new URL(loc, u).toString();
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        if (res.status === 404) throw new LookupError("That page doesn't exist (404). Check the link.", 502);
        if (res.status === 403 || res.status === 429) throw new LookupError("That website blocked us from reading the page. You'll need to add this one by hand.", 502);
        throw new LookupError(`That website answered with an error (${res.status}). Try again later.`, 502);
      }

      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (type && !/text\/html|application\/xhtml\+xml|text\/plain/.test(type)) {
        await res.body?.cancel().catch(() => {});
        throw new LookupError("That link isn't a web page (it looks like a file or an image). Paste the product page link.");
      }
      const { text, truncated } = await readCapped(res);
      return { html: text, finalUrl: u.toString(), truncated };
    }
    throw new LookupError("That link redirects too many times.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/* ═══════════════════════════════════════════════════════════── extraction ══ */

export type Found = {
  title: string;
  brand: string;
  productCode: string;
  gtin: string;
  price: number | null;
  currency: string;
  image: string;
  description: string;
  availabilityRaw: string;
  availabilityNormalised: string;
  source: "structured data" | "page tags";
};

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
   .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

/**
 * Price from a STRUCTURED value only. The verified fact for this catalogue:
 * on Bosch/Neff/Euronics pages the big visible "£" is often the *old* price,
 * so we never scan the page text for the largest number.
 */
function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  // Decide which mark is the decimal separator BEFORE stripping anything:
  // "1.299,00" is one thousand two hundred and ninety-nine, and blindly
  // dropping commas turns it into £1.30 — a 1000x under-price.
  let s = String(v).replace(/[^\d.,-]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s.match(/-?\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function collectJsonLdProducts(html: string): any[] {
  const out: any[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const walk = (node: any, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    if (typeof node !== "object") return;
    const t = node["@type"];
    const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
    if (isProduct) out.push(node);
    for (const key of ["@graph", "mainEntity", "itemListElement", "item", "hasVariant"]) {
      if (node[key]) walk(node[key], depth + 1);
    }
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
    if (!raw) continue;
    try { walk(JSON.parse(raw)); } catch { /* malformed ld+json on the page — ignore it */ }
  }
  return out;
}

function firstOffer(offers: any): any {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    if (o.price != null || o.lowPrice != null || o.priceSpecification?.price != null) return o;
    if (o.offers) { const nested = firstOffer(o.offers); if (nested) return nested; }
  }
  return list.find((o) => o && typeof o === "object") || null;
}

function ldImage(image: any): string {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) { for (const i of image) { const v = ldImage(i); if (v) return v; } return ""; }
  if (typeof image === "object") return String(image.url || image.contentUrl || "");
  return "";
}

function metaTag(html: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${esc}["'][^>]*>`, "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return "";
  return decodeEntities(clean(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || ""));
}

const AVAIL_MAP: Record<string, string> = {
  instock: "in_stock", onlineonly: "in_stock", instoreonly: "in_stock",
  limitedavailability: "limited", presale: "awaiting_stock", preorder: "awaiting_stock",
  backorder: "awaiting_stock", outofstock: "unavailable", soldout: "unavailable",
  discontinued: "unavailable",
};
function normaliseAvailability(raw: string): string {
  const key = raw.replace(/https?:\/\/schema\.org\//i, "").replace(/[^a-z]/gi, "").toLowerCase();
  return AVAIL_MAP[key] || "call_to_confirm";
}

function extract(html: string, finalUrl: string): Found {
  const products = collectJsonLdProducts(html);
  // Prefer the block that actually carries a price — some pages emit a bare
  // Product stub alongside the real one.
  const ld = products.find((p) => firstOffer(p.offers)) || products[0] || null;

  let title = "", brand = "", productCode = "", gtin = "", price: number | null = null;
  let currency = "GBP", image = "", description = "", availabilityRaw = "";
  let source: Found["source"] = "page tags";

  if (ld) {
    source = "structured data";
    title = clean(ld.name);
    brand = clean(typeof ld.brand === "object" ? ld.brand?.name : ld.brand);
    productCode = clean(ld.mpn || ld.sku || ld.productID || ld.model);
    gtin = clean(ld.gtin13 || ld.gtin || ld.gtin12 || ld.gtin14 || ld.gtin8);
    description = clean(ld.description);
    image = clean(ldImage(ld.image));
    const offer = firstOffer(ld.offers);
    if (offer) {
      price = parsePrice(offer.price ?? offer.priceSpecification?.price ?? offer.lowPrice);
      currency = clean(offer.priceCurrency || offer.priceSpecification?.priceCurrency) || "GBP";
      availabilityRaw = clean(offer.availability);
    }
  }

  // Fill any gap from page tags. og:* is not a price source we trust for the big
  // number, but product:price:amount IS a declared structured value — still not
  // "the largest £ on the page", which we never read.
  if (!title) title = metaTag(html, "og:title") || decodeEntities(clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""));
  if (!image) image = metaTag(html, "og:image");
  if (!description) description = metaTag(html, "og:description") || metaTag(html, "description");
  if (!brand) brand = metaTag(html, "og:brand") || metaTag(html, "product:brand") || metaTag(html, "brand");
  if (!productCode) productCode = metaTag(html, "product:retailer_item_id") || metaTag(html, "sku") || metaTag(html, "mpn");
  if (!gtin) gtin = metaTag(html, "product:retailer_part_no") || metaTag(html, "gtin13");
  if (price === null) price = parsePrice(metaTag(html, "product:price:amount") || metaTag(html, "og:price:amount") || metaTag(html, "price"));
  if (!availabilityRaw) availabilityRaw = metaTag(html, "product:availability") || metaTag(html, "og:availability");

  // Make the image absolute so the preview and the saved product both work.
  if (image && !/^https?:\/\//i.test(image)) {
    try { image = new URL(image, finalUrl).toString(); } catch { image = ""; }
  }
  if (image && !/^https:\/\//i.test(image)) image = ""; // never store an http:// image — it breaks on an https site

  return {
    title: title.slice(0, 300),
    brand: brand.slice(0, 80),
    productCode: productCode.slice(0, 80),
    gtin: gtin.slice(0, 40),
    price,
    currency: currency.toUpperCase().slice(0, 3) || "GBP",
    image,
    description: description.slice(0, 2000),
    availabilityRaw: availabilityRaw.replace(/https?:\/\/schema\.org\//i, "").slice(0, 120),
    availabilityNormalised: normaliseAvailability(availabilityRaw),
    source,
  };
}

/* ══════════════════════════════════════════════════════════════ matching ══ */

/** Model codes are written inconsistently ("KGN39VLEAG", "kgn-39 vleag"). */
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type MatchRow = { id: string; title: string; productCode: string; brand: string; slug: string; priceNow: number | null };

async function findMatch(db: any, found: Found): Promise<MatchRow | null> {
  const code = normCode(found.productCode);
  const select = { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true };

  if (found.gtin) {
    const byGtin = await db.product.findFirst({ where: { gtin: found.gtin }, select });
    if (byGtin) return byGtin as MatchRow;
  }
  if (!code) return null;

  // Indexed exact hit first — covers the overwhelming majority.
  const exact = await db.product.findFirst({ where: { productCode: found.productCode.trim() }, select });
  if (exact) return exact as MatchRow;

  // Otherwise compare normalised. The catalogue is ~1,800 rows of two short
  // columns; doing it in JS keeps the comparison identical on sqlite and Postgres.
  const all = await db.product.findMany({ select });
  for (const p of all as MatchRow[]) if (normCode(p.productCode || "") === code) return p;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════ POST ══ */

/** Fields a scrape may fill in — but ONLY when the product's own value is empty. */
const FILL_IF_EMPTY = ["title", "brand", "productCode", "shortDescription", "descriptionText", "mainImage", "gtin"] as const;

function foundValueFor(field: string, found: Found): string {
  switch (field) {
    case "title": return found.title;
    case "brand": return found.brand;
    case "productCode": return found.productCode;
    case "shortDescription": return found.description.slice(0, 300);
    case "descriptionText": return found.description;
    case "mainImage": return "";  // never store a remote URL — next/image only serves configured hosts
    case "gtin": return found.gtin;
    default: return "";
  }
}

const LABEL: Record<string, string> = {
  title: "name", brand: "brand", productCode: "model number", shortDescription: "short description",
  descriptionText: "description", mainImage: "photo", gtin: "barcode", priceNow: "price", priceWas: "was-price",
};

export async function POST(req: Request) {
  // Session auth (401 when absent) + a per-route rate limit. This route makes the
  // SERVER open outbound connections, so it is deliberately tighter than an
  // ordinary product save.
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "scrape" });
  if ("response" in gate) return gate.response;
  const { admin } = gate;

  const body = await req.json().catch(() => ({} as any));
  const url = typeof body?.url === "string" ? body.url : "";
  const apply = body?.apply === true;
  const productId = typeof body?.productId === "string" && body.productId ? body.productId : null;
  const forceCreate = body?.forceCreate === true;

  if (!url.trim()) return NextResponse.json({ ok: false, error: "Paste a product page address first." }, { status: 400 });
  if (url.length > 2048) return NextResponse.json({ ok: false, error: "That web address is too long to be a real product page." }, { status: 400 });

  let found: Found;
  let finalUrl: string;
  const warnings: string[] = [];
  try {
    const page = await fetchPage(url);
    finalUrl = page.finalUrl;
    if (page.truncated) warnings.push("That page was very large, so we only read the first part of it — check the details below carefully.");
    found = extract(page.html, page.finalUrl);
  } catch (e: any) {
    if (e instanceof LookupError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("admin scrape fetch", e);
    return NextResponse.json({ ok: false, error: "Something went wrong reading that page. Try again in a moment." }, { status: 500 });
  }

  if (!found.title && !found.productCode && found.price === null) {
    return NextResponse.json({
      ok: false,
      error: "We read that page but couldn't find any product details on it. It may not be a product page — or the site hides its details from us. You can still add this one using Add product.",
    }, { status: 422 });
  }
  if (!found.productCode) warnings.push("No model number on that page — you'll need to type it in yourself.");
  if (found.price === null) warnings.push("No price on that page. Nothing will be priced automatically.");
  if (found.currency !== "GBP") {
    // Writing a euro figure into a pounds field puts a wrong price on the
    // storefront AND in the Google feed. Drop it; the owner types it himself.
    found.price = null;
    warnings.push(`That page prices in ${found.currency}, not pounds — the price was NOT saved. Enter it yourself.`);
  }

  let db: any;
  try { db = await getPrisma(); }
  catch { return NextResponse.json({ ok: false, error: "The database isn't reachable right now, so we can't check this against your products." }, { status: 503 }); }

  /* ───────────────────────────── preview (default): read only, write nothing */
  if (!apply) {
    let match: MatchRow | null = null;
    try { match = productId ? await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true } }) : await findMatch(db, found); }
    catch (e) { console.error("admin scrape match", e); warnings.push("We couldn't check this against your existing products just now."); }

    return NextResponse.json({
      ok: true, mode: "preview", url: finalUrl, found, warnings,
      matchedProductId: match?.id,
      match: match ? { id: match.id, title: match.title, productCode: match.productCode, brand: match.brand, slug: match.slug, priceNow: match.priceNow } : null,
    });
  }

  /* ─────────────────────────────────────────────────── apply: create/update */
  try {
    // forceCreate is the owner pressing "Add as a separate new product". Without
    // it the server re-matched and silently EDITED the existing row instead —
    // the opposite of what the button says.
    const target: MatchRow | null = productId
      ? await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true } })
      : forceCreate
        ? null
        : await findMatch(db, found);

    if (productId && !target) return NextResponse.json({ ok: false, error: "That product no longer exists — refresh the page and try again." }, { status: 404 });

    /* ── UPDATE ── */
    if (target) {
      const existing = await db.product.findUnique({ where: { id: target.id } });
      if (!existing) return NextResponse.json({ ok: false, error: "That product no longer exists — refresh the page and try again." }, { status: 404 });

      const locked = new Set<string>(Array.isArray(existing.adminOverrideFields) ? (existing.adminOverrideFields as any[]).map(String) : []);
      const data: Record<string, any> = {};
      const updated: { field: string; label: string; from: any; to: any }[] = [];
      const skipped: { field: string; label: string; reason: string }[] = [];

      for (const field of FILL_IF_EMPTY) {
        const value = foundValueFor(field, found);
        if (!value) continue;
        const current = existing[field];
        if (locked.has(field)) { skipped.push({ field, label: LABEL[field] || field, reason: "you set this yourself, so it was left alone" }); continue; }
        if (current !== null && current !== undefined && String(current).trim() !== "") {
          skipped.push({ field, label: LABEL[field] || field, reason: "already filled in, so it was left alone" });
          continue;
        }
        data[field] = (EDITABLE as readonly string[]).includes(field) ? coerce(field, value) : value;
        updated.push({ field, label: LABEL[field] || field, from: current ?? "", to: data[field] });
      }

      // Price is the one field a re-read is allowed to REPLACE — that is the point
      // of the tool. Unless the owner has set it himself, in which case it is
      // locked and we say so out loud rather than quietly overwriting him.
      if (found.price !== null) {
        if (locked.has("priceNow")) {
          skipped.push({ field: "priceNow", label: "price", reason: "you set this price yourself, so it was left alone" });
        } else if (existing.priceNow !== found.price) {
          data.priceNow = coerce("priceNow", found.price);
          reconcileSaving(data, { priceNow: existing.priceNow, priceWas: existing.priceWas });
          updated.push({ field: "priceNow", label: "price", from: existing.priceNow, to: data.priceNow });
        }
      }

      if (!existing.sourceUrl) data.sourceUrl = finalUrl;
      data.lastScrapedAt = new Date();

      if (!updated.length) {
        return NextResponse.json({
          ok: true, mode: "unchanged", productId: target.id, slug: target.slug, title: target.title,
          updated: [], skipped, warnings,
          message: "Nothing to change — everything on that page was either already filled in or set by you.",
        });
      }

      const saved = await db.product.update({ where: { id: target.id }, data });
      await writeAudit(db, {
        entityType: "product", entityId: saved.id, action: "admin:scrape-apply",
        changedFields: updated.map((u) => u.field),
        previousValue: Object.fromEntries(updated.map((u) => [u.field, u.from])),
        newValue: { ...Object.fromEntries(updated.map((u) => [u.field, u.to])), sourceUrl: finalUrl },
        changedBy: admin.email,
      });
      try { await syncProductToRag(db, saved.id); } catch { /* best effort */ }
      revalidateStorefront(["/", "/products"]);

      return NextResponse.json({
        ok: true, mode: "updated", productId: saved.id, slug: saved.slug, title: saved.title,
        updated, skipped, warnings,
        message: `Updated ${saved.title}. ${updated.length} thing${updated.length === 1 ? "" : "s"} filled in from that page${skipped.length ? `; ${skipped.length} left alone.` : "."}`,
      });
    }

    /* ── CREATE ── */
    if (!found.title) return NextResponse.json({ ok: false, error: "That page has no product name on it, so there's nothing to create. Use Add product instead." }, { status: 422 });
    if (!found.productCode) {
      return NextResponse.json({
        ok: false,
        error: "That page doesn't show a model number, and every product needs one — customers quote it on the phone. Use Add product and type it in.",
      }, { status: 422 });
    }

    const data: Record<string, any> = {
      title: coerce("title", found.title),
      brand: coerce("brand", found.brand) || "Unbranded",
      productCode: coerce("productCode", found.productCode),
      priceNow: found.price === null ? null : coerce("priceNow", found.price),
      availabilityNormalised: found.availabilityNormalised,
      availabilityRaw: found.availabilityRaw,
      shortDescription: found.description.slice(0, 300),
      descriptionText: found.description,
      mainImage: "",  // see safeImage(): a foreign URL would break next/image
    };
    reconcileSaving(data);

    const base = slugify(`${data.brand}-${data.productCode}`) || slugify(String(data.title));
    let slug = base || `product-${Date.now()}`;
    for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

    const created = await db.product.create({
      data: {
        slug,
        title: data.title,
        brand: data.brand,
        productCode: data.productCode,
        category: "", subcategory: "",
        priceNow: data.priceNow ?? null,
        priceWas: null,
        saving: data.saving ?? null,
        availabilityNormalised: data.availabilityNormalised,
        availabilityRaw: data.availabilityRaw,
        warranty: "",
        shortDescription: data.shortDescription,
        descriptionText: data.descriptionText,
        mainImage: data.mainImage,
        gtin: found.gtin,
        // Nothing here was typed by the owner, so nothing is locked yet — the
        // next re-read is free to refresh it.
        adminOverrideFields: [],
        isVisible: true, featured: false,
        lastScrapedAt: new Date(),
        sourceUrl: finalUrl, oldUrl: "", currency: "GBP", descriptionHtml: "",
        breadcrumbs: [], specifications: [], features: [],
        galleryImages: data.mainImage ? [data.mainImage] : [],
        relatedProductCodes: [], serviceAddOns: [], energyLabelUrl: "", deliveryNotes: "",
        seoTitle: `${data.brand} ${data.title}`.trim().slice(0, 68),
        seoDescription: `${data.title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
      },
    });

    await writeAudit(db, {
      entityType: "product", entityId: created.id, action: "admin:scrape-apply",
      changedFields: Object.keys(data),
      previousValue: {},
      newValue: { title: created.title, productCode: created.productCode, priceNow: created.priceNow, sourceUrl: finalUrl },
      changedBy: admin.email,
    });
    try { await syncProductToRag(db, created.id); } catch { /* best effort */ }
    try {
      await ensureBrand(db, created.brand);
      await recomputeCounts(db, { brands: [created.brand] });
    } catch { /* best effort */ }
    revalidateStorefront(["/", "/products"]);

    return NextResponse.json({
      ok: true, mode: "created", productId: created.id, slug: created.slug, title: created.title,
      updated: Object.keys(data).map((f) => ({ field: f, label: LABEL[f] || f, from: "", to: data[f] })),
      skipped: [], warnings,
      message: `Created ${created.title}. It has no category yet — open it and set one so it shows in the right department.`,
    }, { status: 201 });
  } catch (e: any) {
    if (e instanceof ValidationError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error("admin scrape apply", e);
    return NextResponse.json({ ok: false, error: "We read the page, but saving it failed. Is the database running?" }, { status: 500 });
  }
}
