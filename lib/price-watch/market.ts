import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { searchAnalytics } from "@/lib/search-console";

/**
 * Admin → Pricewire → Market (Sachin, 14 Nov 2026): the shop's prices, demand
 * and Google search in one place.
 *   pulse:   what changed this week against the week before;
 *   daily:   prices the price agent changed, product views and call taps, by day;
 *   versus:  Bosch, Neff and Siemens against Ruislip Appliances;
 *   cards:   the products worth a decision, each tagged with the job it needs —
 *            promote, most watched, Ruislip cheaper, price moved, SEO to fix —
 *            with its photo, price graph, who is looking and where from;
 *   margin:  only where a cost price is on file — none is guessed.
 */
const DAY = 86_400_000;
const COMPETITOR = "ruislip-appliances";
const BRANDS = ["Bosch", "Neff", "Siemens"];
const PER_TAG = 12;
const round2 = (n: number) => Math.round(n * 100) / 100;
const vat = (o: { price: number; includesVat?: boolean | null }) => (o.includesVat === false ? round2(o.price * 1.2) : o.price);
const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export type Tag = "promote" | "watched" | "dearer" | "moved" | "seo";
export type Visitors = { google: number; ads: number; ai: number; direct: number; other: number };
export type MarketCard = {
  id: string; code: string; slug: string; brand: string; title: string; image: string;
  price: number | null; ruislip: number | null;
  views7: number; views30: number; calls30: number; from: Visitors;
  googleClicks: number; googleImpressions: number; googlePosition: number | null;
  /** The followed site's move over the window, in % (Bosch, Neff, Siemens only). */
  movePct: number | null; moveFrom: number | null;
  /** Our own price over 90 days, oldest first — the card's small graph. */
  spark: { at: string; price: number }[];
  hasSeoTitle: boolean;
  /** Each job this product is on the list for: its place in that list (0 = first) and why. */
  jobs: Partial<Record<Tag, { rank: number; why: string }>>;
};
export type Market = {
  days: number;
  pulse: { changes7: number; changesPrev7: number; firstPrices7: number; views7: number; viewsPrev7: number; calls7: number; callsPrev7: number };
  daily: { day: string; up: number; down: number; views: number; calls: number }[];
  trend: { brand: string; site: string; read: number; up: number; down: number; avgPct: number }[];
  versus: { brand: string; cheaper: number; same: number; dearer: number; notListed: number }[];
  cards: MarketCard[];
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

/** Where a visit came from, in the owner's words. */
export function visitorKind(e: { source?: string | null; referrer?: string | null }): keyof Visitors {
  const src = String(e.source || "").toLowerCase(), ref = String(e.referrer || "").toLowerCase();
  if (src === "google-ads") return "ads";
  if (/chatgpt|openai|perplexity|copilot|gemini|claude\.ai/.test(ref) || /chatgpt|perplexity/.test(src)) return "ai";
  if (/google\./.test(ref)) return "google";
  if (!ref && !src) return "direct";
  return "other";
}

/** Google shows the page but it sits low, or people look at it and it has no search title of its own. */
export function seoOpportunity(c: { googleImpressions: number; googlePosition: number | null; views30: number; hasSeoTitle: boolean }): string {
  if (c.googleImpressions >= 10 && c.googlePosition !== null && c.googlePosition > 5) return `Google showed it ${c.googleImpressions} times at position ${c.googlePosition} — a sharper title can lift it`;
  if (c.views30 >= 3 && !c.hasSeoTitle) return `${c.views30} views and no search title of its own yet`;
  return "";
}

export async function marketInsights(db: any, days = 30): Promise<Market> {
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const poa = await poaNamesFromDb(db);
  const all: any[] = await db.product.findMany({
    where: { isVisible: true },
    select: { id: true, productCode: true, slug: true, title: true, brand: true, category: true, subcategory: true, pricewire: true, priceNow: true, costPrice: true, mainImage: true, seoTitle: true },
  });
  // A call-for-price product has no price to compare or graph: it can be watched, nothing else.
  const shown = (p: any) => (isPoaProduct(poa, p) ? null : typeof p.priceNow === "number" ? p.priceNow : null);
  const byId = new Map(all.map((p) => [p.id, p]));
  const feedBrand = all.filter((p) => BRANDS.includes(p.brand) && shown(p) !== null);

  // ---- trend: what each brand's followed site did over the window
  const feeds: any[] = await db.brandPriceFeed.findMany({ where: { brand: { in: BRANDS } } });
  const trend: Market["trend"] = [];
  const move = new Map<string, { from: number; pct: number }>();
  for (const f of feeds) {
    // Filtered here, not with a long IN list: SQLite (local) caps query parameters.
    const mine = new Set(feedBrand.filter((p) => p.brand === f.brand).map((p) => p.id));
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
      fl.pct > 0 ? up++ : down++;
      sum += fl.pct;
      move.set(id, { from: fl.from, pct: fl.pct });
    }
    trend.push({ brand: f.brand, site: f.siteId, read: per.size, up, down, avgPct: up + down ? round2(sum / (up + down)) : 0 });
  }

  // ---- Ruislip Appliances' newest read in the last week, any brand
  const rObs: any[] = await db.priceObservation.findMany({
    where: { sourceId: COMPETITOR, status: "ok", observedAt: { gte: new Date(now - 7 * DAY) } },
    orderBy: { observedAt: "desc" }, select: { productId: true, price: true, includesVat: true },
  });
  const ruislip = new Map<string, number>();
  for (const o of rObs) if (byId.has(o.productId) && o.price > 0 && !ruislip.has(o.productId)) ruislip.set(o.productId, vat(o));
  const versus = BRANDS.map((brand) => {
    const v = { brand, cheaper: 0, same: 0, dearer: 0, notListed: 0 };
    for (const p of feedBrand.filter((x) => x.brand === brand)) {
      const r = ruislip.get(p.id);
      if (r === undefined) v.notListed++;
      else if (Math.abs(p.priceNow - r) < 0.01) v.same++;
      else if (p.priceNow < r) v.cheaper++;
      else v.dearer++;
    }
    return v;
  });

  // ---- demand: who looked, who called, where they came from
  const events: any[] = await db.trackedEvent.findMany({
    where: { type: { in: ["page_view", "call_click"] }, createdAt: { gte: new Date(now - Math.max(days, 14) * DAY) } },
    select: { type: true, productSlug: true, source: true, referrer: true, createdAt: true },
  });
  const blank = (): Visitors => ({ google: 0, ads: 0, ai: 0, direct: 0, other: 0 });
  const demand = new Map<string, { views7: number; views30: number; calls30: number; from: Visitors }>();
  const daily = new Map<string, { day: string; up: number; down: number; views: number; calls: number }>();
  for (let i = days - 1; i >= 0; i--) { const day = dayKey(new Date(now - i * DAY)); daily.set(day, { day, up: 0, down: 0, views: 0, calls: 0 }); }
  const pulse = { changes7: 0, changesPrev7: 0, firstPrices7: 0, views7: 0, viewsPrev7: 0, calls7: 0, callsPrev7: 0 };
  for (const e of events) {
    const age = now - new Date(e.createdAt).getTime(), view = e.type === "page_view";
    // The pulse and the daily graph count product pages only, so they agree with the cards.
    if (!e.productSlug) continue;
    if (age < 7 * DAY) view ? pulse.views7++ : pulse.calls7++;
    else if (age < 14 * DAY) view ? pulse.viewsPrev7++ : pulse.callsPrev7++;
    const d = daily.get(dayKey(e.createdAt));
    if (d) view ? d.views++ : d.calls++;
    if (age >= days * DAY) continue;
    const m = demand.get(e.productSlug) || { views7: 0, views30: 0, calls30: 0, from: blank() };
    if (view) { m.views30++; if (age < 7 * DAY) m.views7++; m.from[visitorKind(e)]++; } else m.calls30++;
    demand.set(e.productSlug, m);
  }

  // ---- prices the price agent changed (a first price onto a Call product is counted apart: it is not a move)
  const applied: any[] = await db.adminAuditLog.findMany({
    where: { entityType: "product", action: "price-watch:auto-apply", createdAt: { gte: since } },
    select: { createdAt: true, previousValue: true, newValue: true },
  });
  for (const a of applied) {
    const from = a.previousValue?.priceNow, to = a.newValue?.priceNow, age = now - new Date(a.createdAt).getTime();
    if (typeof to !== "number") continue;
    if (typeof from !== "number") { if (age < 7 * DAY) pulse.firstPrices7++; continue; }
    if (age < 7 * DAY) pulse.changes7++; else if (age < 14 * DAY) pulse.changesPrev7++;
    const d = daily.get(dayKey(a.createdAt));
    if (d) to > from ? d.up++ : d.down++;
  }

  // ---- Google search for each product's page
  let google: Market["google"] = "connected";
  const gsc = new Map<string, { clicks: number; impressions: number; position: number }>();
  try {
    const rows = await searchAnalytics(db, "page", 28);
    if (!rows) google = "not_connected";
    for (const r of rows || []) { const m = r.key.match(/\/products\/([^/?#]+)/); if (m) gsc.set(decodeURIComponent(m[1]), r); }
  } catch (e: any) { google = String(e?.message || e).slice(0, 160); }

  // ---- one card per product worth a decision, tagged with the job
  const base = (p: any): MarketCard => {
    const d = demand.get(p.slug), g = gsc.get(p.slug), mv = move.get(p.id);
    return {
      id: p.id, code: p.productCode, slug: p.slug, brand: p.brand, title: p.title, image: p.mainImage || "",
      price: shown(p), ruislip: shown(p) === null ? null : ruislip.get(p.id) ?? null,
      views7: d?.views7 || 0, views30: d?.views30 || 0, calls30: d?.calls30 || 0, from: d?.from || blank(),
      googleClicks: g?.clicks || 0, googleImpressions: g?.impressions || 0, googlePosition: g ? round2(g.position) : null,
      movePct: mv?.pct ?? null, moveFrom: mv?.from ?? null, spark: [], hasSeoTitle: !!String(p.seoTitle || "").trim(),
      jobs: {},
    };
  };
  const cards = new Map<string, MarketCard>();
  const tag = (list: { c: MarketCard; why: string; score: number }[], t: Tag) => {
    list.sort((a, b) => b.score - a.score).slice(0, PER_TAG).forEach(({ c, why }, rank) => {
      c.jobs[t] = { rank, why };
      cards.set(c.id, c);
    });
  };
  const candidates = all.map(base);
  const gbp = (n: number) => `£${round2(n).toLocaleString("en-GB")}`;
  const taps = (n: number) => `${n} call tap${n === 1 ? "" : "s"}`;
  tag(candidates.filter((c) => c.price !== null && BRANDS.includes(c.brand) && (c.views30 || c.calls30 || c.googleImpressions))
    .map((c) => ({ c, score: promoteScore({ views: c.views30, calls: c.calls30, googleClicks: c.googleClicks, googleImpressions: c.googleImpressions, price: c.price!, ruislip: c.ruislip }),
      why: [c.ruislip === null ? "Ruislip doesn't list it" : c.price! < c.ruislip ? `${gbp(c.ruislip - c.price!)} under Ruislip` : "Same price as Ruislip", c.calls30 ? taps(c.calls30) : "", `${c.views30} view${c.views30 === 1 ? "" : "s"}`].filter(Boolean).join(" · ") }))
    .filter((x) => x.score > 0), "promote");
  tag(candidates.filter((c) => c.views7 > 0).map((c) => ({ c, score: c.views7 + 5 * c.calls30, why: `${c.views7} view${c.views7 === 1 ? "" : "s"} this week${c.calls30 ? ` · ${taps(c.calls30)}` : ""}` })), "watched");
  tag(candidates.filter((c) => c.price !== null && c.ruislip !== null && c.price > c.ruislip + 0.01)
    .map((c) => ({ c, // Money at stake: the gap times the people looking at it.
      score: (c.views30 + 5 * c.calls30 + 1) * (c.price! - c.ruislip!), why: `Ruislip sells it for ${gbp(c.ruislip!)}, ${gbp(c.price! - c.ruislip!)} less than us${c.views30 ? ` · ${c.views30} people looked` : ""}` })), "dearer");
  tag(candidates.filter((c) => c.movePct).map((c) => ({ c, score: Math.abs(c.movePct!), why: `The site it follows put its price ${c.movePct! > 0 ? "up" : "down"} ${Math.abs(c.movePct!).toFixed(1)}%, from ${gbp(c.moveFrom!)}` })), "moved");
  tag(candidates.map((c) => ({ c, why: seoOpportunity(c), score: c.googleImpressions + c.views30 * 5 })).filter((x) => x.why), "seo");

  // ---- our own price over 90 days, for the cards' graphs
  const picked = [...cards.values()];
  if (picked.length) {
    const audit: any[] = await db.adminAuditLog.findMany({
      where: { entityType: "product", entityId: { in: picked.map((c) => c.id) }, createdAt: { gte: new Date(now - 90 * DAY) } },
      orderBy: { createdAt: "asc" }, select: { entityId: true, createdAt: true, previousValue: true, newValue: true },
    });
    for (const a of audit) {
      const c = cards.get(a.entityId)!, before = a.previousValue?.priceNow, after = a.newValue?.priceNow;
      if (typeof after !== "number" || before === after) continue;
      if (!c.spark.length && typeof before === "number") c.spark.push({ at: new Date(now - 90 * DAY).toISOString(), price: before });
      c.spark.push({ at: new Date(a.createdAt).toISOString(), price: after });
    }
    for (const c of picked) if (c.price !== null) {
      if (!c.spark.length) c.spark.push({ at: new Date(now - 90 * DAY).toISOString(), price: c.price });
      c.spark.push({ at: new Date(now).toISOString(), price: c.price });
    }
  }

  // ---- margin: only with a cost on file (ex VAT, as the product form stores it)
  const withCost = feedBrand.filter((p) => typeof p.costPrice === "number" && p.costPrice > 0);
  const marginRows = withCost.map((p) => ({ code: p.productCode, slug: p.slug, price: p.priceNow, cost: p.costPrice, marginPct: round2(((p.priceNow / 1.2 - p.costPrice) / (p.priceNow / 1.2)) * 100) }))
    .sort((a, b) => b.marginPct - a.marginPct).slice(0, 25);

  return { days, pulse, daily: [...daily.values()], trend, versus, cards: picked, google, margin: { withCost: withCost.length, priced: feedBrand.length, rows: marginRows } };
}

/**
 * Google Shopping feed labels from the same data as Market, so an ad campaign
 * can bid on the products most likely to sell (merchant-feed.xml):
 *   custom_label_1 "Promote"              £100 or more, at or under Ruislip Appliances' price, and viewed or called about in 30 days
 *                                         (a click costs ~£0.30–1.30: not worth paying for on a £6 spare part);
 *   custom_label_2 "Price drop"           the price agent lowered it in the last 30 days and it still sits there;
 *   custom_label_3 "Cheaper than Ruislip" under Ruislip Appliances' price this week.
 * Read from the database only (no Google call), so the feed stays fast.
 */
export type FeedLabels = { promote: boolean; priceDrop: boolean; cheaperThanRuislip: boolean };
export const PROMOTE_FROM = 100;
export function labelFor(r: { price: number; ruislip: number | null; views: number; calls: number; droppedTo: number | null }): FeedLabels {
  const notDearer = r.ruislip === null || r.price <= r.ruislip + 0.01;
  return {
    promote: r.price >= PROMOTE_FROM && notDearer && r.views + r.calls > 0,
    priceDrop: r.droppedTo !== null && Math.abs(r.droppedTo - r.price) < 0.01,
    cheaperThanRuislip: r.ruislip !== null && r.price < r.ruislip - 0.01,
  };
}
export async function feedLabels(db: any, rows: { slug: string; priceNow: number }[]): Promise<Map<string, FeedLabels>> {
  const now = Date.now(), since = new Date(now - 30 * DAY);
  const products: any[] = await db.product.findMany({ where: { isVisible: true, priceNow: { not: null } }, select: { id: true, slug: true } });
  const idOf = new Map(products.map((p) => [p.slug, p.id]));
  const [rObs, events, applied] = await Promise.all([
    db.priceObservation.findMany({ where: { sourceId: COMPETITOR, status: "ok", observedAt: { gte: new Date(now - 7 * DAY) } }, orderBy: { observedAt: "desc" }, select: { productId: true, price: true, includesVat: true } }),
    db.trackedEvent.findMany({ where: { type: { in: ["page_view", "call_click"] }, productSlug: { not: "" }, createdAt: { gte: since } }, select: { type: true, productSlug: true } }),
    db.adminAuditLog.findMany({ where: { entityType: "product", action: "price-watch:auto-apply", createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { entityId: true, previousValue: true, newValue: true } }),
  ]);
  const ruislip = new Map<string, number>();
  for (const o of rObs) if (o.price > 0 && !ruislip.has(o.productId)) ruislip.set(o.productId, vat(o));
  const views = new Map<string, number>(), calls = new Map<string, number>();
  for (const e of events) { const m = e.type === "page_view" ? views : calls; m.set(e.productSlug, (m.get(e.productSlug) || 0) + 1); }
  // The latest automatic change per product: a drop if it went down.
  const dropped = new Map<string, number | null>();
  for (const a of applied) {
    const from = a.previousValue?.priceNow, to = a.newValue?.priceNow;
    if (typeof to === "number") dropped.set(a.entityId, typeof from === "number" && to < from ? to : null);
  }
  const out = new Map<string, FeedLabels>();
  for (const r of rows) {
    const id = idOf.get(r.slug);
    out.set(r.slug, labelFor({ price: r.priceNow, ruislip: id ? ruislip.get(id) ?? null : null, views: views.get(r.slug) || 0, calls: calls.get(r.slug) || 0, droppedTo: id ? dropped.get(id) ?? null : null }));
  }
  return out;
}
