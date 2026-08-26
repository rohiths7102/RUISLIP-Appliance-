/**
 * Daily supplier price collector — runs OFF the website, on the Oracle n8n box.
 *
 *   node daily-sync.mjs --source manufacturer-rrp   Bosch + NEFF, from their own
 *                                                   product pages (RRP)
 *   node daily-sync.mjs --source euronics           Euronics-carried lines
 *   ...add --dry-run to fetch and report without posting anything.
 *
 * WHY IT LIVES HERE AND NOT IN THE APP
 * A full sweep is ~1,300 pages at 1/sec — far past any serverless request
 * budget. This script is deliberately standalone: no Prisma, no database
 * credentials, no repo imports. It only needs SITE_URL and a collector secret,
 * so it is safe to run on a box that should never hold DB access.
 *
 * WHAT IT MAY AND MAY NOT DO
 * It OBSERVES. It cannot set a price. The ingest endpoint refuses to write
 * Product.priceNow, and the "collector" key is scoped to advisory sources, so
 * every number it reports lands in /admin/price-watch behind the deterministic
 * guards for a human to accept. A stolen collector secret cannot move a price.
 *
 * OUTPUT
 * A JSON summary on the last line (marked SUMMARY_JSON:) for the n8n workflow
 * to hand to Gemini, which writes the Telegram digest. The script itself does
 * no AI and no messaging — it just reports facts.
 *
 * ENV
 *   SITE_URL                      https://ruislip-appliance.vercel.app
 *   PRICE_INGEST_SECRET_COLLECTOR the shared secret for keyId "collector"
 */
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const arg = (n, d = "") => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const SOURCE = arg("--source", "manufacturer-rrp");
const LIMIT = Number(arg("--limit", "500")) || 500;
const DELAY_MS = Number(arg("--delay", "1000")) || 1000;
const DRY = args.includes("--dry-run");

const SITE = (process.env.SITE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.PRICE_INGEST_SECRET_COLLECTOR || "";
if (!SITE || !SECRET) { console.error("SITE_URL and PRICE_INGEST_SECRET_COLLECTOR are required"); process.exit(1); }

const UA = "JyotsnaElectricalBot/1.0 (+daily price sync; contact rohith@kroneuszerotrust.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirrors lib/machine-auth.ts signingPayload: `${route}.${timestamp}.${rawBody}` */
function sign(route, timestamp, rawBody) {
  return createHmac("sha256", SECRET).update(`${route}.${timestamp}.${rawBody}`).digest("hex");
}
function authHeaders(route, rawBody) {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "x-pw-key": "collector", "x-pw-timestamp": ts, "x-pw-signature": sign(route, ts, rawBody) };
}

async function getWorklist() {
  const route = "worklist";
  const r = await fetch(`${SITE}/api/price-ingest/worklist?source=${encodeURIComponent(SOURCE)}&limit=${LIMIT}`, {
    headers: { ...authHeaders(route, ""), "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`worklist ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.products || j.items || [];
}

async function postObservations(observations) {
  const rawBody = JSON.stringify({ sourceId: SOURCE, observations });
  const r = await fetch(`${SITE}/api/price-ingest/observations`, {
    method: "POST",
    headers: { ...authHeaders("observations", rawBody), "Content-Type": "application/json", "User-Agent": UA },
    body: rawBody,
  });
  if (!r.ok) throw new Error(`observations ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Price + stock from a page's JSON-LD Product schema. Same priority the app uses. */
function extract(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let product = null;
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) product = product || o;
    for (const k in o) walk(o[k]);
  };
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* malformed block — skip */ } }
  if (!product) return null;
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (!offer) return null;
  const price = Number(offer.price ?? offer.lowPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, inStock: /InStock/i.test(String(offer.availability || "")) };
}

async function fetchPage(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------

/**
 * Which hosts legitimately back each source. The worklist is ordered by
 * staleness and price, NOT by where a product came from, so most of what it
 * returns for "manufacturer-rrp" is now Euronics-sourced stock. Fetching those
 * and filing them under manufacturer-rrp would label a Euronics retail price as
 * a manufacturer RRP — the wrong number under the wrong source, which the guards
 * would then reason about incorrectly. So each source only ever reads its own hosts.
 */
const HOSTS = {
  "manufacturer-rrp": [/(^|\.)bosch-home\.co\.uk$/i, /(^|\.)neff-home\.com$/i],
  euronics: [/(^|\.)euronics\.co\.uk$/i],
};

const started = new Date().toISOString();
const work = await getWorklist();
// Only products whose own source page we can re-read. No searching, no guessing:
// a wrong match here would report another appliance's price against this one.
const allowed = HOSTS[SOURCE] || [];
const targets = work.filter((p) => {
  if (!/^https:\/\//.test(p.sourceUrl || "")) return false;
  if (!allowed.length) return true; // a source with no host rule reads whatever it is given
  let host = "";
  try { host = new URL(p.sourceUrl).hostname; } catch { return false; }
  return allowed.some((re) => re.test(host));
});
if (work.length && !targets.length) {
  console.log(`worklist had ${work.length} products but none are hosted on this source's own site — nothing to do.`);
}
console.log(`source=${SOURCE} worklist=${work.length} fetchable=${targets.length}${DRY ? " (dry run)" : ""}`);

const observations = [];
const changes = [];
let priced = 0, failed = 0;

for (const p of targets) {
  const html = await fetchPage(p.sourceUrl);
  const found = html ? extract(html) : null;

  if (!found) {
    failed++;
    // A failed read is REPORTED, never dropped: silence must not look like a
    // stable price, and it must never read as "discontinued".
    observations.push({
      productId: p.productId || p.id, price: null, deliveryCost: null, inStock: null,
      sourceUrl: p.sourceUrl, matchConfidence: 1, status: "parse_failed",
      note: "no price in JSON-LD",
    });
    await sleep(DELAY_MS);
    continue;
  }

  priced++;
  observations.push({
    productId: p.productId || p.id, price: found.price, deliveryCost: null,
    inStock: found.inStock, sourceUrl: p.sourceUrl, matchConfidence: 1,
    status: "ok", note: "manufacturer page",
  });

  const ours = typeof p.priceNow === "number" ? p.priceNow : null;
  if (ours !== null && Math.abs(found.price - ours) >= 1) {
    changes.push({
      code: p.productCode, brand: p.brand, title: (p.title || "").slice(0, 70),
      ours, supplier: found.price, diff: +(found.price - ours).toFixed(2),
    });
  }
  await sleep(DELAY_MS);
}

let posted = 0;
if (!DRY && observations.length) {
  for (let i = 0; i < observations.length; i += 500) {
    const res = await postObservations(observations.slice(i, i + 500));
    posted += res.created ?? res.written ?? observations.slice(i, i + 500).length;
  }
}

changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
const summary = {
  source: SOURCE, startedAt: started, finishedAt: new Date().toISOString(),
  checked: targets.length, priced, failed, posted, dryRun: DRY,
  changeCount: changes.length,
  weAreOver: changes.filter((c) => c.diff < 0).length,
  weAreUnder: changes.filter((c) => c.diff > 0).length,
  topChanges: changes.slice(0, 20),
  reviewUrl: `${SITE}/admin/price-watch`,
};

console.log(`priced=${priced} failed=${failed} posted=${posted} changes=${changes.length}`);
for (const c of changes.slice(0, 10)) {
  console.log(`  ${String(c.code).padEnd(16)} ours £${String(c.ours).padEnd(9)} supplier £${String(c.supplier).padEnd(9)} ${c.diff > 0 ? "+" : ""}${c.diff}`);
}
// Last line, machine-readable, for n8n -> Gemini -> Telegram.
console.log("SUMMARY_JSON:" + JSON.stringify(summary));
