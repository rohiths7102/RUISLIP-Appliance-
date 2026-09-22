/**
 * Prove every old URL lands on a real page here.
 *
 *   node scripts/migration/verify-redirects.mjs http://localhost:3005
 *   node scripts/migration/verify-redirects.mjs https://ruislip-appliance.vercel.app
 *
 * Driven by the crawl, not by the map: for every URL the old site exposes,
 * request it from the host given, follow the redirect, and require a 200 at
 * the end — with at least one product on it when it is a listing, because a
 * 200 with nothing on it is a soft 404 to Google. A sample of product URLs is
 * also requested under a made-up slug, since the old site keys on the id and
 * Google may hold an older slug.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) { console.error("usage: verify-redirects.mjs <base url>"); process.exit(2); }
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const rows = fs.readFileSync(path.join(ROOT, "data", "old-site-urls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((r) => r.kind !== "home");

const isListing = (u) => /^\/categories\//.test(u) || /^\/products(\?|$)/.test(u);

async function follow(url) {
  const hops = [];
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": "redirect-verify" } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      hops.push(`${r.status} -> ${loc}`);
      url = new URL(loc, url).href;
      continue;
    }
    const html = r.status === 200 ? await r.text() : "";
    return { status: r.status, hops, final: url, cards: (html.match(/class="card-lift/g) || []).length };
  }
  return { status: 0, hops, final: url, cards: 0 };
}

const cases = rows.map((r) => ({ label: r.url, path: r.url }));
// The wildcard: the same id under a slug the old site never had.
for (const r of rows.filter((x) => x.kind === "product").slice(0, 8)) {
  cases.push({ label: `${r.url}  (as /some-old-slug/p-id)`, path: r.url.replace(/^\/[^/]+\//, "/some-old-slug/") });
}

let pass = 0; const fails = [];
const chained = [];
const queue = [...cases];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const c = queue.shift();
    const res = await follow(BASE + c.path);
    const landed = new URL(res.final).pathname + new URL(res.final).search;
    const redirected = res.hops.length > 0;
    const soft404 = isListing(landed) && res.cards === 0;
    if (res.hops.length > 1) chained.push(`${c.label}: ${res.hops.join("  ")}`);
    if (res.status === 200 && redirected && !soft404) pass++;
    else fails.push(`${c.label}\n      ${res.hops.join("  ")}  => ${res.status}${soft404 ? " (listing with no products)" : ""}${!redirected ? " (no redirect — served directly)" : ""}`);
  }
}));

console.log(`${BASE}: ${pass}/${cases.length} old URLs land on a real page`);
if (chained.length) { console.log(`
${chained.length} took more than one hop:`); for (const c of chained) console.log("  " + c); }
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  " + f); process.exit(1); }
