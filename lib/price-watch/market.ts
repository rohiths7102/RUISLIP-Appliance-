import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { searchAnalytics } from "@/lib/search-console";

/**
 * Admin → Pricewire → Pricing engine → Market (Sachin, 14 Nov 2026): for
 * Bosch, Neff and Siemens —
 *   trend:   which prices the followed sites moved in the last 30 days;
 *   versus:  our price against Ruislip Appliances, product by product;
 *   promote: products we price at or under Ruislip, ranked by real demand
 *            (page views and call taps on our site, Google search clicks and
 *            impressions for the product's page);
 *   margin:  only where a cost price is on file — none is guessed.
 */
const DAY = 86_400_000;
const COMPETITOR = "ruislip-appliances";
const BRANDS = ["Bosch", "Neff", "Siemens"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const vat = (o: { price: number; includesVat?: boolean | null }) => (o.includesVat === false ? round2(o.price * 1.2) : o.price);

export type Move = { code: string; slug: string; brand: string; title: string; from: number; to: number; pct: number };
export type PromoteRow = {
  code: string; slug: string; brand: string; title: string; price: number; ruislip: number | null;
  views: number; calls: number; googleClicks: number; googleImpressions: number; googlePosition: number | null; score: number; why: string;
};
export type Market = {
  days: number;
  trend: { brand: string; site: string; read: number; up: number; down: number; avgPct: number }[];
  risers: Move[]; fallers: Move[];
  versus: { brand: string; cheaper: number; same: number; dearer: number; notListed: number }[];
  dearer: { code: string; slug: string; brand: string; price: number; ruislip: number; pct: number }[];
  promote: PromoteRow[];
  google: "connected" | "not_connected" | string;
  margin: { withCost: number; priced: number; rows: { code: string; slug: string; price: number; cost: number; marginPct: number }[] };
};

/** One product's first and latest price in the window from one source (newest-first reads). */
export function firstAndLast(reads: { price: number; includesVat?: boolean | null }[]) {
  if (reads.length < 2) return null;
  const to = vat(reads[0]), from = vat(reads[reads.length - 1]);
  return Math.abs(to - from) < 0.01 ? { from, to, pct: 0 } : { from, to, pct: round2(((to - from) / from) * 100) };
}

/** Promotion score: demand first, then how far we sit under Ruislip. Demand without a price edge still counts; a dearer product is never promoted. */
export function promoteScore(r: { views: number; calls: number; googleClicks: number; googleImpressions: number; price: number; ruislip: number | null }) {
  if (r.ruislip !== null && r.price > r.ruislip + 0.01) return 0;
  // The price edge breaks ties between products people want; capped so a cheap item a few pounds under never outranks real demand.
  const edge = r.ruislip ? Math.min(5, Math.max(0, (r.ruislip - r.price) / r.ruislip) * 20) : 0;
  return round2(r.views + 5 * r.calls + 3 * r.googleClicks + r.googleImpressions / 50 + edge);
}

export async function marketInsights(db: any, days = 30): Promise<Market> {
  const since = new Date(Date.now() - days * DAY);
  const poa = await poaNamesFromDb(db);
  const feeds: any[] = await db.brandPriceFeed.findMany({ where: { brand: { in: BRANDS } } });
  const products: any[] = (await db.product.findMany({
    where: { brand: { in: BRANDS }, isVisible: true },
    select: { id: true, productCode: true, slug: true, title: true, brand: true, category: true, subcategory: true, pricewire: true, priceNow: true, costPrice: true },
  })).filter((p: any) => !isPoaProduct(poa, p));
  const byId = new Map(products.map((p) => [p.id, p]));

  // ---- trend: what each brand's followed site did over the window
  const trend: Market["trend"] = [];
  const moves: Move[] = [];
  for (const f of feeds) {
    // Filtered here, not with a long IN list: SQLite (local) caps query parameters.
    const mine = new Set(products.filter((p) => p.brand === f.brand).map((p) => p.id));
    const obs: any[] = await db.priceObservation.findMany({
      where: { sourceId: f.siteId, status: "ok", observedAt: { gte: since } },
      orderBy: { observedAt: "desc" }, select: { productId: true, price: true, includesVat: true },
    });
    const per = new Map<string, any[]>();
    for (const o of obs) { if (!mine.has(o.productId) || !(o.price > 0)) continue; const h = per.get(o.productId) || []; h.push(o); per.set(o.productId, h); }
    let up = 0, down = 0, sum = 0;
    for (const [id, h] of per) {
      const fl = firstAndLast(h);
      if (!fl || !fl.pct) continue;
      const p = byId.get(id);
      fl.pct > 0 ? up++ : down++;
      sum += fl.pct;
      moves.push({ code: p.productCode, slug: p.slug, brand: p.brand, title: p.title, ...fl });
    }
    trend.push({ brand: f.brand, site: f.siteId, read: per.size, up, down, avgPct: up + down ? round2(sum / (up + down)) : 0 });
  }
  const risers = moves.filter((m) => m.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 15);
  const fallers = moves.filter((m) => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 15);

  // ---- versus Ruislip Appliances (their newest read in the last week)
  const rObs: any[] = await db.priceObservation.findMany({
    where: { sourceId: COMPETITOR, status: "ok", observedAt: { gte: new Date(Date.now() - 7 * DAY) } },
    orderBy: { observedAt: "desc" }, select: { productId: true, price: true, includesVat: true },
  });
  const ruislip = new Map<string, number>();
  for (const o of rObs) if (byId.has(o.productId) && o.price > 0 && !ruislip.has(o.productId)) ruislip.set(o.productId, vat(o));
  const priced = products.filter((p) => typeof p.priceNow === "number");
  const versus = BRANDS.map((brand) => {
    const v = { brand, cheaper: 0, same: 0, dearer: 0, notListed: 0 };
    for (const p of priced.filter((x) => x.brand === brand)) {
      const r = ruislip.get(p.id);
      if (r === undefined) v.notListed++;
      else if (Math.abs(p.priceNow - r) < 0.01) v.same++;
      else if (p.priceNow < r) v.cheaper++;
      else v.dearer++;
    }
    return v;
  });
  const dearer = priced.filter((p) => ruislip.has(p.id) && p.priceNow > ruislip.get(p.id)! + 0.01)
    .map((p) => ({ code: p.productCode, slug: p.slug, brand: p.brand, price: p.priceNow, ruislip: ruislip.get(p.id)!, pct: round2((p.priceNow / ruislip.get(p.id)! - 1) * 100) }))
    .sort((a, b) => b.pct - a.pct).slice(0, 25);

  // ---- demand: our own visitors, and Google search for the product's page
  const events: any[] = await db.trackedEvent.findMany({
    where: { type: { in: ["page_view", "call_click"] }, productSlug: { not: "" }, createdAt: { gte: since } }, select: { type: true, productSlug: true },
  });
  const views = new Map<string, number>(), calls = new Map<string, number>();
  for (const e of events) { const m = e.type === "page_view" ? views : calls; m.set(e.productSlug, (m.get(e.productSlug) || 0) + 1); }
  let google: Market["google"] = "connected";
  const gsc = new Map<string, { clicks: number; impressions: number; position: number }>();
  try {
    const rows = await searchAnalytics(db, "page", 28);
    if (!rows) google = "not_connected";
    for (const r of rows || []) { const m = r.key.match(/\/products\/([^/?#]+)/); if (m) gsc.set(decodeURIComponent(m[1]), r); }
  } catch (e: any) { google = String(e?.message || e).slice(0, 160); }

  const promote: PromoteRow[] = priced.map((p) => {
    const g = gsc.get(p.slug);
    const row = { code: p.productCode, slug: p.slug, brand: p.brand, title: p.title, price: p.priceNow, ruislip: ruislip.get(p.id) ?? null,
      views: views.get(p.slug) || 0, calls: calls.get(p.slug) || 0, googleClicks: g?.clicks || 0, googleImpressions: g?.impressions || 0, googlePosition: g ? round2(g.position) : null };
    const score = promoteScore(row);
    const why = [
      row.ruislip !== null && row.price < row.ruislip ? `£${round2(row.ruislip - row.price)} under Ruislip` : row.ruislip !== null ? "same as Ruislip" : "Ruislip doesn't list it",
      row.calls ? `${row.calls} call taps` : "", row.views ? `${row.views} views` : "",
      row.googleImpressions ? `${row.googleImpressions} Google impressions (avg position ${row.googlePosition})` : "",
    ].filter(Boolean).join(" · ");
    return { ...row, score, why };
  }).filter((r) => r.score > 0 && (r.views || r.calls || r.googleImpressions)).sort((a, b) => b.score - a.score).slice(0, 25);

  // ---- margin: only with a cost on file (ex VAT, as the product form stores it)
  const withCost = priced.filter((p) => typeof p.costPrice === "number" && p.costPrice > 0);
  const marginRows = withCost.map((p) => ({ code: p.productCode, slug: p.slug, price: p.priceNow, cost: p.costPrice, marginPct: round2(((p.priceNow / 1.2 - p.costPrice) / (p.priceNow / 1.2)) * 100) }))
    .sort((a, b) => b.marginPct - a.marginPct).slice(0, 25);

  return { days, trend, risers, fallers, versus, dearer, promote, google, margin: { withCost: withCost.length, priced: priced.length, rows: marginRows } };
}
