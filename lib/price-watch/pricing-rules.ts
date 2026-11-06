import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { writeAudit } from "@/lib/audit";
import { ensureAiSources } from "@/lib/price-watch/pricewire-ai";
import { sourcePrices, type SourcePrice } from "@/lib/price-watch/pricewire-agent";

/**
 * Pricewire pricing rules, alerts and price history.
 *
 * A rule says what our price should be from the other sources' prices — e.g.
 * "Bosch dishwashers: £5 under the lowest source, ending .99, never below cost
 * + 10%, never above Bosch's own price". Rules run after the morning read and
 * on demand; each result is a "pricing-rules" observation in the review queue,
 * applied (or not) by the owner through the guarded apply route. A product
 * takes the first enabled rule that fits it (lowest priority number first).
 * Euronics agency stock and call-for-price products are never priced by a rule.
 */

export type Strategy = "match_lowest" | "beat_lowest" | "match_source";
export type RuleInput = {
  name: string; enabled: boolean; priority: number; brand: string; category: string; strategy: Strategy; sourceIds: string;
  amount: number; amountUnit: "gbp" | "pct"; rounding: "none" | "99" | "00"; minMarginPct: number; capAtMaker: boolean; maxChangePct: number;
};
export type Rule = RuleInput & { id: string; lastRunAt: Date | string | null; lastRunSummary: string };

const MAKER_SOURCES = new Set(["bosch-home", "neff-home", "siemens-home", "manufacturer-rrp", "pricewire:bosch-home", "pricewire:neff-home", "pricewire:siemens-home"]);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Price endings apply from £50: rounding a £8.89 accessory down to £7.99 would be an 11% cut nobody asked for. */
export const ROUND_FROM = 50;
const roundTo = (x: number, how: RuleInput["rounding"]) => (x < ROUND_FROM || how === "none" ? round2(x) : how === "99" ? round2(Math.floor(x + 0.01) - 0.01) : Math.floor(x));
const roundUp = (x: number, how: RuleInput["rounding"]) => (x < ROUND_FROM || how === "none" ? round2(Math.ceil(x * 100) / 100) : how === "99" ? round2(Math.ceil(x + 0.01) - 0.01) : Math.ceil(x));

/** A rule from a form or JSON body, checked; or the reason it can't be saved. */
export function checkRule(b: any): RuleInput | string {
  const name = String(b?.name || "").trim().slice(0, 80);
  if (!name) return "Give the rule a name.";
  const strategy = ["match_lowest", "beat_lowest", "match_source"].includes(b?.strategy) ? b.strategy : null;
  if (!strategy) return "Choose what the rule does.";
  const sourceIds = String(b?.sourceIds || "").split(",").map((s) => s.trim()).filter(Boolean).join(",");
  if (strategy === "match_source" && !sourceIds) return "Pick the source to follow.";
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const amount = Math.max(0, num(b?.amount, 0));
  const amountUnit = b?.amountUnit === "pct" ? "pct" : "gbp";
  if (amountUnit === "pct" && amount > 50) return "A percentage over 50% isn't a sensible discount.";
  return {
    name, enabled: b?.enabled !== false, priority: Math.round(num(b?.priority, 100)), brand: String(b?.brand || "").trim().slice(0, 40),
    category: String(b?.category || "").trim().slice(0, 80), strategy, sourceIds, amount, amountUnit,
    rounding: b?.rounding === "none" || b?.rounding === "00" ? b.rounding : "99",
    minMarginPct: Math.min(1, Math.max(0, num(b?.minMarginPct, 0.1))), capAtMaker: b?.capAtMaker !== false, maxChangePct: Math.min(100, Math.max(1, num(b?.maxChangePct, 25))),
  };
}

/** Whether a rule covers a product. */
export const ruleFits = (r: Pick<RuleInput, "brand" | "category">, p: { brand: string; category: string; subcategory: string }) =>
  (!r.brand || r.brand.toLowerCase() === String(p.brand).toLowerCase())
  && (!r.category || [p.category, p.subcategory].some((c) => String(c).toLowerCase() === r.category.toLowerCase()));

export type Target = { price: number; reason: string } | { price: null; reason: string; flag?: "too_big" };

/** What one rule says a product's price should be. Pure: every number it needs is passed in. */
export function targetPrice(r: RuleInput, x: { ours: number | null; sources: SourcePrice[]; costExVat: number | null; floor: number | null }): Target {
  const wanted = r.sourceIds ? r.sourceIds.split(",") : [];
  const pool = wanted.length ? x.sources.filter((s) => wanted.includes(s.sourceId)) : x.sources;
  const money = (n: number) => `£${n.toFixed(2)}`;
  let base: number, why: string;
  if (r.strategy === "match_source") {
    const s = wanted.map((id) => pool.find((p) => p.sourceId === id)).find(Boolean);
    if (!s) return { price: null, reason: "the chosen source has no price for it" };
    base = s.price; why = `${s.source} ${money(s.price)}`;
  } else {
    if (!pool.length) return { price: null, reason: "no other source has a price for it" };
    const low = pool.reduce((a, b) => (b.price < a.price ? b : a));
    const off = r.strategy === "beat_lowest" ? (r.amountUnit === "pct" ? low.price * (r.amount / 100) : r.amount) : 0;
    base = low.price - off;
    why = `lowest ${low.source} ${money(low.price)}${off ? ` − ${r.amountUnit === "pct" ? `${r.amount}%` : money(r.amount)}` : ""}`;
  }
  let price = roundTo(base, r.rounding);
  const floors = [x.floor, x.costExVat !== null ? x.costExVat * 1.2 * (1 + r.minMarginPct) : null].filter((v): v is number => typeof v === "number" && v > 0);
  const floor = floors.length ? Math.max(...floors) : null;
  if (floor !== null && price < floor) { price = roundUp(floor, r.rounding); why += `, held at the floor ${money(price)}`; }
  const maker = x.sources.filter((s) => MAKER_SOURCES.has(s.sourceId)).map((s) => s.price);
  if (r.capAtMaker && maker.length && price > Math.min(...maker)) {
    const cap = roundTo(Math.min(...maker), "none");
    // Cost wins over the cap: never sell below cost + margin to stay under the maker's price.
    if (floor !== null && cap < floor) return { price: null, reason: `cost + margin (${money(roundUp(floor, r.rounding))}) is above the maker's price ${money(cap)}` };
    price = cap; why += `, capped at the maker's ${money(price)}`;
  }
  if (!(price > 0)) return { price: null, reason: "the rule gives no usable price" };
  // A move under £1 is the price ending, not a pricing decision.
  if (x.ours !== null && Math.abs(price - x.ours) < 1) return { price: null, reason: "already at that price (within £1)" };
  if (x.ours !== null && x.ours > 0 && (Math.abs(price - x.ours) / x.ours) * 100 > r.maxChangePct)
    return { price: null, reason: `${money(price)} would move it more than ${r.maxChangePct}% (${why})`, flag: "too_big" };
  return { price, reason: `${why} → ${money(price)}` };
}

export type RulesRun = { rules: { id: string; name: string; products: number; suggested: number; held: number }[]; suggested: number };

/** Run every enabled rule; results go to the review queue. */
export async function runRules(db: any, by: string): Promise<RulesRun> {
  const rules: Rule[] = await db.pricingRule.findMany({ where: { enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const out: RulesRun = { rules: rules.map((r) => ({ id: r.id, name: r.name, products: 0, suggested: 0, held: 0 })), suggested: 0 };
  if (!rules.length) return out;
  await ensureAiSources(db);
  const [products, poa] = await Promise.all([
    db.product.findMany({ where: { isVisible: true }, select: { id: true, brand: true, category: true, subcategory: true, priceNow: true, costPrice: true, floorPrice: true, agencyStock: true, pricewire: true } }),
    poaNamesFromDb(db),
  ]);
  const byRule = new Map<string, any[]>();
  for (const p of products) {
    if (p.agencyStock === true || isPoaProduct(poa, p)) continue;
    const r = rules.find((r) => ruleFits(r, p));
    if (r) byRule.set(r.id, [...(byRule.get(r.id) || []), p]);
  }
  const ids = [...byRule.values()].flat().map((p) => p.id);
  const prices = ids.length ? await sourcePrices(db, ids) : new Map();
  const last = new Map<string, number>();
  if (ids.length) {
    for (const o of await db.priceObservation.findMany({ where: { sourceId: "pricing-rules", productId: { in: ids }, status: "ok" }, orderBy: { observedAt: "desc" }, select: { productId: true, price: true } })) {
      if (!last.has(o.productId)) last.set(o.productId, o.price);
    }
  }
  const now = new Date();
  const obs: any[] = [];
  for (const r of rules) {
    const tally = out.rules.find((t) => t.id === r.id)!;
    for (const p of byRule.get(r.id) || []) {
      tally.products++;
      const t = targetPrice(r, { ours: typeof p.priceNow === "number" ? p.priceNow : null, sources: prices.get(p.id) || [], costExVat: p.costPrice ?? null, floor: p.floorPrice ?? null });
      if (t.price === null) { if ((t as any).flag) tally.held++; continue; }
      if (last.get(p.id) === t.price) continue; // already suggested; still in the queue or dismissed
      tally.suggested++;
      obs.push({ productId: p.id, sourceId: "pricing-rules", price: t.price, deliveryCost: null, inStock: null, includesVat: true, sourceUrl: `rule:${r.id}`,
        matchConfidence: 1, status: "ok", note: `Rule “${r.name}”: ${t.reason}`.slice(0, 190), observedAt: now });
    }
    await db.pricingRule.update({ where: { id: r.id }, data: { lastRunAt: now, lastRunSummary: `${tally.products} products, ${tally.suggested} new suggestions${tally.held ? `, ${tally.held} held (move too big)` : ""}` } });
  }
  for (let i = 0; i < obs.length; i += 500) await db.priceObservation.createMany({ data: obs.slice(i, i + 500) });
  out.suggested = obs.length;
  await writeAudit(db, { entityType: "pricewire-rules", entityId: "run", action: "pricewire:rules-run", changedFields: [], previousValue: {}, newValue: out, changedBy: by });
  return out;
}

/* ------------------------------------------------------------------ alerts */

export type Alert = { kind: "undercut" | "moved" | "layout" | "blocked" | "to_confirm" | "queue"; level: "danger" | "warning" | "info"; text: string; code?: string; slug?: string };

/** What needs the owner's eye: who undercuts us, sites in trouble, matches to confirm. */
export async function pricewireAlerts(db: any): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const poa = await poaNamesFromDb(db);
  const since = new Date(Date.now() - 3 * 86_400_000);
  const recent: any[] = await db.priceObservation.findMany({
    where: { observedAt: { gte: since }, status: "ok", price: { not: null }, NOT: { sourceId: { in: ["ai-assistant", "pricing-rules"] } } },
    orderBy: { observedAt: "desc" }, take: 20000, select: { productId: true, sourceId: true, price: true, includesVat: true },
  });
  const lowest = new Map<string, { price: number; sourceId: string }>();
  for (const o of recent) {
    const price = o.includesVat === false ? round2(o.price * 1.2) : o.price;
    const cur = lowest.get(o.productId);
    if (!cur || price < cur.price) lowest.set(o.productId, { price, sourceId: o.sourceId });
  }
  if (lowest.size) {
    const products: any[] = await db.product.findMany({ where: { id: { in: [...lowest.keys()] }, isVisible: true }, select: { id: true, productCode: true, slug: true, priceNow: true, category: true, pricewire: true, subcategory: true, brand: true, agencyStock: true } });
    const labels = new Map<string, string>((await db.priceSource.findMany({ select: { id: true, label: true } })).map((s: any) => [s.id, s.label]));
    const under = products.filter((p) => typeof p.priceNow === "number" && !isPoaProduct(poa, p) && p.agencyStock !== true)
      .map((p) => ({ p, l: lowest.get(p.id)! })).filter(({ p, l }) => l.price < p.priceNow * 0.95)
      .sort((a, b) => (b.p.priceNow - b.l.price) / b.p.priceNow - (a.p.priceNow - a.l.price) / a.p.priceNow).slice(0, 15);
    for (const { p, l } of under) alerts.push({ kind: "undercut", level: "warning", code: p.productCode, slug: p.slug,
      text: `${p.productCode}: ${labels.get(l.sourceId) || l.sourceId} is £${l.price.toFixed(2)}, we're £${p.priceNow.toFixed(2)} (${Math.round((1 - l.price / p.priceNow) * 100)}% dearer)` });
  }
  const moved = await db.brandPriceItem.count({ where: { lastChangeAt: { gte: new Date(Date.now() - 2 * 86_400_000) } } }).catch(() => 0);
  if (moved) alerts.push({ kind: "moved", level: "info", text: `${moved} Bosch, Neff or Siemens prices moved on the sites Pricewire follows in the last two days` });
  for (const s of await db.priceSite.findMany({ where: { enabled: true } })) {
    if (s.priceSelector && s.selectorMisses >= 5) alerts.push({ kind: "layout", level: "danger", text: `${s.name}: the learned price location found nothing on ${s.selectorMisses} pages in a row — its layout may have changed. Teach the price again.` });
    if (/blocking|robots/i.test(s.lastReadSummary || "")) alerts.push({ kind: "blocked", level: "danger", text: `${s.name}: ${s.lastReadSummary}` });
  }
  const review = await db.productSiteLink?.count({ where: { status: "review" } }).catch(() => 0);
  if (review) alerts.push({ kind: "to_confirm", level: "info", text: `${review} product matches are waiting for you to confirm (Mapping → Matches to confirm)` });
  return alerts;
}

/* ----------------------------------------------------------------- history */

export type HistorySeries = { label: string; points: { at: string; price: number }[] };

/** One product's price over the last 90 days: ours (from the audit log) and every source's. */
export async function priceHistory(db: any, code: string) {
  const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const all: any[] = await db.product.findMany({ select: { id: true, productCode: true } });
  const hit = all.find((p) => norm(p.productCode) === norm(code));
  if (!hit) return null;
  const p = await db.product.findUnique({ where: { id: hit.id }, select: { id: true, productCode: true, title: true, brand: true, slug: true, priceNow: true } });
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [audit, obs, sources] = await Promise.all([
    db.adminAuditLog.findMany({ where: { entityType: "product", entityId: p.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, previousValue: true, newValue: true, changedFields: true } }),
    db.priceObservation.findMany({ where: { productId: p.id, observedAt: { gte: since }, status: "ok", price: { not: null } }, orderBy: { observedAt: "asc" }, select: { sourceId: true, price: true, includesVat: true, observedAt: true } }),
    db.priceSource.findMany({ select: { id: true, label: true } }),
  ]);
  const label = new Map<string, string>(sources.map((s: any) => [s.id, s.label]));
  const ours: HistorySeries = { label: "Our price", points: [] };
  const val = (v: any) => (v && typeof v === "object" && typeof v.priceNow === "number" ? v.priceNow : null);
  for (const a of audit) {
    const before = val(a.previousValue), after = val(a.newValue);
    if (after === null) continue;
    if (!ours.points.length && before !== null) ours.points.push({ at: new Date(a.createdAt).toISOString(), price: before });
    ours.points.push({ at: new Date(a.createdAt).toISOString(), price: after });
  }
  if (typeof p.priceNow === "number") ours.points.push({ at: new Date().toISOString(), price: p.priceNow });
  const bySource = new Map<string, HistorySeries>();
  for (const o of obs) {
    const s: HistorySeries = bySource.get(o.sourceId) || { label: label.get(o.sourceId) || o.sourceId, points: [] };
    s.points.push({ at: new Date(o.observedAt).toISOString(), price: o.includesVat === false ? round2(o.price * 1.2) : o.price });
    bySource.set(o.sourceId, s);
  }
  return { product: p, series: [ours, ...bySource.values()].filter((s) => s.points.length) };
}
