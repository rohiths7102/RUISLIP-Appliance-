import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import {
  DEFAULT_GUARD_CONFIG,
  effectiveFloor,
  evaluateGuards,
  noObservationResult,
  type GuardConfig,
  type GuardResult,
} from "@/lib/price-watch/guards";

/**
 * Read helpers for the price-watch admin UI and the ingest worklist.
 *
 * `db` is the Prisma client — callers pass `await getPrisma()` (lib/prisma.ts),
 * matching lib/counts.ts and lib/poa.ts. Nothing here writes.
 *
 * The hard constraint on this file is query count. The catalogue is ~1,929
 * products; a per-product observation lookup is 1,929 round trips and the
 * admin page times out. Every helper below fetches in a fixed number of
 * queries and reduces in JS.
 */

const DAY_MS = 86_400_000;
const OBSERVATION_WINDOW_DAYS = 30;

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const daysBetween = (a: Date, b: Date): number => (a.getTime() - b.getTime()) / DAY_MS;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** The latest observation from one source for one product, VAT-normalised. */
export type LatestObservation = {
  observationId: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: string;
  sourceAllowsAutoApply: boolean;
  /** Exactly as the source stated it, on the source's own VAT basis. */
  price: number | null;
  /** `price` moved onto our inc-VAT basis. null when there is no price. */
  normalisedPrice: number | null;
  /** True when we grossed an ex-VAT quote up to inc-VAT to get normalisedPrice. */
  vatConverted: boolean;
  /** null means UNKNOWN, never free. Normalised onto the inc-VAT basis too. */
  deliveryCost: number | null;
  /** normalisedPrice + deliveryCost. null when either is unknown. */
  landedPrice: number | null;
  inStock: boolean | null;
  includesVat: boolean;
  matchConfidence: number;
  status: string;
  note: string;
  sourceUrl: string;
  observedAt: Date;
  ageDays: number;
};

export type PriceWatchRow = {
  productId: string;
  slug: string;
  title: string;
  brand: string;
  productCode: string;
  gtin: string;
  category: string;
  subcategory: string;
  isVisible: boolean;
  isPoa: boolean;
  /** Our advertised price, inc-VAT. */
  ourPrice: number | null;
  costPrice: number | null;
  floorPrice: number | null;
  /** Computed inc-VAT floor (cost + true margin, or the explicit override). */
  floor: number | null;
  lastScrapedAt: Date | null;
  priceAgeDays: number | null;
  /** Latest observation per source, cheapest normalised price first. */
  observations: LatestObservation[];
  /** The observation the deltas and guardResult are measured against. */
  reference: LatestObservation | null;
  /** ourPrice - reference.normalisedPrice. Positive = we are dearer. */
  deltaAbs: number | null;
  /** deltaAbs as a fraction of the reference price. */
  deltaPct: number | null;
  /** ourPrice - reference.landedPrice. null when their delivery is unknown. */
  landedDelta: number | null;
  guardResult: GuardResult;
};

type SourceRow = { id: string; label: string; kind: string; allowAutoApply: boolean; enabled: boolean; priceIncludesVat: boolean };

type ObservationRow = {
  id: string;
  productId: string;
  sourceId: string;
  price: number | null;
  deliveryCost: number | null;
  inStock: boolean | null;
  includesVat: boolean;
  sourceUrl: string;
  matchConfidence: number;
  status: string;
  note: string;
  observedAt: Date;
};

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  productCode: string;
  gtin: string;
  category: string;
  subcategory: string;
  priceNow: number | null;
  costPrice: number | null;
  floorPrice: number | null;
  isVisible: boolean;
  lastScrapedAt: Date | null;
};

const OBSERVATION_SELECT = {
  id: true,
  productId: true,
  sourceId: true,
  price: true,
  deliveryCost: true,
  inStock: true,
  includesVat: true,
  sourceUrl: true,
  matchConfidence: true,
  status: true,
  note: true,
  observedAt: true,
} as const;

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  title: true,
  brand: true,
  productCode: true,
  gtin: true,
  category: true,
  subcategory: true,
  priceNow: true,
  costPrice: true,
  floorPrice: true,
  isVisible: true,
  lastScrapedAt: true,
} as const;

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
};

// ---------------------------------------------------------------------------
// priceWatchRows
// ---------------------------------------------------------------------------

/**
 * Every visible product with at least one observation in the last 30 days,
 * with its latest observation PER SOURCE and the guard verdict on the best
 * candidate price.
 *
 * FOUR queries total, regardless of catalogue size:
 *   1. observations inside the window (ordered newest-first),
 *   2. the products those observations point at,
 *   3. the price sources,
 *   4. the POA category names (lib/poa.ts).
 *
 * "Latest per source" is a group by (productId, sourceId) taking max
 * observedAt. Prisma's groupBy cannot return the whole row for the max, and
 * doing it per product is the N+1 this file exists to avoid, so the single
 * ordered fetch is reduced in JS: the first row seen for a (product, source)
 * pair IS the latest, because the query is ordered observedAt desc.
 */
export async function priceWatchRows(db: any, opts?: { limit?: number }): Promise<PriceWatchRow[]> {
  const limit = isPositive(opts?.limit) ? Math.floor(opts!.limit!) : 500;
  const now = new Date();
  const since = new Date(now.getTime() - OBSERVATION_WINDOW_DAYS * DAY_MS);
  const cfg: GuardConfig = DEFAULT_GUARD_CONFIG;

  const observations: ObservationRow[] = await db.priceObservation.findMany({
    where: { observedAt: { gte: since } },
    select: OBSERVATION_SELECT,
    orderBy: { observedAt: "desc" },
  });
  if (!observations.length) return [];

  // Ordered newest-first, so keep only the first row per (product, source).
  const latestByProduct = new Map<string, Map<string, ObservationRow>>();
  for (const o of observations) {
    let bySource = latestByProduct.get(o.productId);
    if (!bySource) {
      bySource = new Map<string, ObservationRow>();
      latestByProduct.set(o.productId, bySource);
    }
    if (!bySource.has(o.sourceId)) bySource.set(o.sourceId, o);
  }

  const productIds = Array.from(latestByProduct.keys());
  const [products, sources, poaNames] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds }, isVisible: true }, select: PRODUCT_SELECT }) as Promise<ProductRow[]>,
    db.priceSource.findMany({
      select: { id: true, label: true, kind: true, allowAutoApply: true, enabled: true, priceIncludesVat: true },
    }) as Promise<SourceRow[]>,
    poaNamesFromDb(db),
  ]);

  const sourceById = new Map<string, SourceRow>(sources.map((s) => [s.id, s]));

  const rows: PriceWatchRow[] = [];
  for (const p of products) {
    const bySource = latestByProduct.get(p.id);
    if (!bySource) continue;

    const isPoa = isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory });
    const floor = effectiveFloor({
      costPrice: p.costPrice,
      floorPrice: p.floorPrice,
      minMarginPct: cfg.minMarginPct,
      vatRate: cfg.vatRate,
    });

    const obsList: LatestObservation[] = [];
    for (const o of bySource.values()) {
      const src = sourceById.get(o.sourceId);
      const observedAt = asDate(o.observedAt) || new Date(0);
      // The observation's own includesVat is authoritative: it was copied from
      // the source at observe time precisely so a later config change cannot
      // retro-reinterpret it. The source row is only the fallback.
      const includesVat = typeof o.includesVat === "boolean" ? o.includesVat : src?.priceIncludesVat !== false;
      const vatConverted = includesVat === false && o.price != null;
      const gross = (n: number): number => round2(includesVat ? n : n * (1 + cfg.vatRate));
      const normalisedPrice = o.price == null ? null : gross(o.price);
      const deliveryCost = o.deliveryCost == null ? null : gross(o.deliveryCost);
      obsList.push({
        observationId: o.id,
        sourceId: o.sourceId,
        sourceLabel: src?.label || o.sourceId,
        sourceKind: src?.kind || "advisory",
        sourceAllowsAutoApply: src?.allowAutoApply === true,
        price: o.price,
        normalisedPrice,
        vatConverted,
        deliveryCost,
        landedPrice: normalisedPrice == null || deliveryCost == null ? null : round2(normalisedPrice + deliveryCost),
        inStock: o.inStock ?? null,
        includesVat,
        matchConfidence: typeof o.matchConfidence === "number" ? o.matchConfidence : 0,
        status: o.status || "",
        note: o.note || "",
        sourceUrl: o.sourceUrl || "",
        observedAt,
        ageDays: round2(daysBetween(now, observedAt)),
      });
    }

    // Cheapest usable observation first; unusable rows sink to the bottom but
    // are still returned, because "the scraper has been failing for a week" is
    // exactly the thing the owner needs to see.
    obsList.sort((a, b) => {
      const au = a.status === "ok" && a.normalisedPrice != null;
      const bu = b.status === "ok" && b.normalisedPrice != null;
      if (au !== bu) return au ? -1 : 1;
      return (a.normalisedPrice ?? Number.POSITIVE_INFINITY) - (b.normalisedPrice ?? Number.POSITIVE_INFINITY);
    });

    // The reference is the cheapest usable normalised price across sources —
    // the price the market is actually showing against ours.
    const reference = obsList.find((o) => o.status === "ok" && o.normalisedPrice != null) || null;
    const ourPrice = isPositive(p.priceNow) ? p.priceNow : null;

    let deltaAbs: number | null = null;
    let deltaPct: number | null = null;
    let landedDelta: number | null = null;
    let guardResult: GuardResult = noObservationResult(floor);

    if (reference && reference.normalisedPrice != null) {
      if (ourPrice != null) {
        deltaAbs = round2(ourPrice - reference.normalisedPrice);
        deltaPct = reference.normalisedPrice > 0 ? round2((deltaAbs / reference.normalisedPrice) * 10000) / 100 : null;
        // Our own delivery is quoted per order and is not modelled here, so
        // this compares our shelf price with their price PLUS their delivery.
        landedDelta = reference.landedPrice == null ? null : round2(ourPrice - reference.landedPrice);
      }
      guardResult = evaluateGuards({
        proposal: {
          productId: p.id,
          currentPrice: ourPrice,
          proposedPrice: reference.normalisedPrice,
          sourceId: reference.sourceId,
          sourceKind: reference.sourceKind,
          sourceAllowsAutoApply: reference.sourceAllowsAutoApply,
          vatConversionApplied: reference.vatConverted,
          observation: {
            price: reference.price,
            deliveryCost: reference.deliveryCost,
            inStock: reference.inStock,
            includesVat: reference.includesVat,
            matchConfidence: reference.matchConfidence,
            status: reference.status,
            sourceUrl: reference.sourceUrl,
            observedAt: reference.observedAt,
          },
        },
        product: { costPrice: p.costPrice, floorPrice: p.floorPrice, category: p.category, subcategory: p.subcategory, isPoa },
        poaNames,
        config: cfg,
        now,
      });
    }

    const lastScrapedAt = asDate(p.lastScrapedAt);
    rows.push({
      productId: p.id,
      slug: p.slug,
      title: p.title,
      brand: p.brand,
      productCode: p.productCode,
      gtin: p.gtin || "",
      category: p.category || "",
      subcategory: p.subcategory || "",
      isVisible: p.isVisible,
      isPoa,
      ourPrice,
      costPrice: p.costPrice ?? null,
      floorPrice: p.floorPrice ?? null,
      floor,
      lastScrapedAt,
      priceAgeDays: lastScrapedAt ? round2(daysBetween(now, lastScrapedAt)) : null,
      observations: obsList,
      reference,
      deltaAbs,
      deltaPct,
      landedDelta,
      guardResult,
    });
  }

  // Biggest mispricing first — that is the whole point of the page. Rows with
  // no comparable observation sort last rather than counting as delta 0.
  rows.sort((a, b) => {
    const av = a.deltaPct == null ? -1 : Math.abs(a.deltaPct);
    const bv = b.deltaPct == null ? -1 : Math.abs(b.deltaPct);
    if (av !== bv) return bv - av;
    return a.title.localeCompare(b.title);
  });

  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// worklistProducts
// ---------------------------------------------------------------------------

export type WorklistProduct = {
  /** The collector posts observations keyed on this — it must match the name the
   *  ingest endpoint and the n8n workflow both use. `id` is kept as an alias. */
  productId: string;
  id: string;
  slug: string;
  title: string;
  brand: string;
  /** The collector searches on these three, in this order of preference. */
  gtin: string;
  productCode: string;
  category: string;
  subcategory: string;
  ourPrice: number | null;
  /** Alias of ourPrice under the name the collector reads. */
  priceNow: number | null;
  /** Last time THIS source saw this product. null = never observed. */
  lastObservedAt: Date | null;
  observationAgeDays: number | null;
};

/**
 * Products due a price check from one source, oldest-observation-first.
 *
 * Never-observed products come first (they are infinitely stale), then the
 * longest-unchecked. Only visible, non-POA products with a productCode are
 * included: a POA product must never receive an applied price, so spending
 * collector budget on one is pure waste, and without a productCode the
 * collector has nothing to search on.
 *
 * THREE queries: the source's observations, the candidate products, the POA
 * names. The observation set is reduced to a max(observedAt) per product in
 * JS rather than one lookup per product.
 */
export async function worklistProducts(db: any, opts: { limit: number; sourceId: string }): Promise<WorklistProduct[]> {
  const limit = isPositive(opts?.limit) ? Math.floor(opts.limit) : 50;
  const sourceId = (opts?.sourceId || "").trim();
  if (!sourceId) return [];
  const now = new Date();

  const [observations, products, poaNames] = await Promise.all([
    db.priceObservation.findMany({
      where: { sourceId },
      select: { productId: true, observedAt: true },
      orderBy: { observedAt: "desc" },
    }) as Promise<{ productId: string; observedAt: Date }[]>,
    db.product.findMany({
      where: { isVisible: true, NOT: { productCode: "" } },
      select: PRODUCT_SELECT,
    }) as Promise<ProductRow[]>,
    poaNamesFromDb(db),
  ]);

  // Ordered desc, so the first row per product is that product's latest.
  const lastSeen = new Map<string, Date>();
  for (const o of observations) {
    if (lastSeen.has(o.productId)) continue;
    const d = asDate(o.observedAt);
    if (d) lastSeen.set(o.productId, d);
  }

  const due: WorklistProduct[] = [];
  for (const p of products) {
    if (!p.productCode || !p.productCode.trim()) continue;
    if (isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory })) continue;
    const last = lastSeen.get(p.id) || null;
    due.push({
      productId: p.id,
      id: p.id,
      slug: p.slug,
      title: p.title,
      brand: p.brand,
      gtin: p.gtin || "",
      productCode: p.productCode,
      category: p.category || "",
      subcategory: p.subcategory || "",
      ourPrice: isPositive(p.priceNow) ? p.priceNow : null,
      priceNow: isPositive(p.priceNow) ? p.priceNow : null,
      lastObservedAt: last,
      observationAgeDays: last ? round2(daysBetween(now, last)) : null,
    });
  }

  // Never-observed first, then oldest observation first — but among products of
  // equal staleness, check the DEAREST first.
  //
  // The nightly request budget is small and deliberately so (politeness caps in
  // the collector). Spending it on £4 spare parts is waste twice over: a pound
  // mispriced on a £900 oven dwarfs the whole accessories aisle, and the buying
  // group's site does not even list most manufacturer spares — the first live
  // run burned its entire budget on Bosch part numbers and correctly returned
  // "not found" for every one.
  due.sort((a, b) => {
    const at = a.lastObservedAt ? a.lastObservedAt.getTime() : Number.NEGATIVE_INFINITY;
    const bt = b.lastObservedAt ? b.lastObservedAt.getTime() : Number.NEGATIVE_INFINITY;
    if (at !== bt) return at - bt;
    const ap = a.priceNow ?? -1;
    const bp = b.priceNow ?? -1;
    if (ap !== bp) return bp - ap; // dearest first; unpriced last
    return a.productId.localeCompare(b.productId);
  });

  return due.slice(0, limit);
}

// ---------------------------------------------------------------------------
// priceAgeReport
// ---------------------------------------------------------------------------

export type PriceAgeBucket = {
  key: string;
  label: string;
  /** Inclusive lower bound in days; null for the "never scraped" bucket. */
  minDays: number | null;
  /** Inclusive upper bound in days; null = unbounded. Buckets are matched in
   *  order, so a value on a shared boundary lands in the younger bucket. */
  maxDays: number | null;
  count: number;
  /** Of `count`, how many actually show a price on the storefront. */
  pricedCount: number;
};

export type PriceAgeReport = {
  generatedAt: Date;
  totalVisible: number;
  /** Visible products that display a price — the ones staleness can mislead on. */
  totalPriced: number;
  neverScraped: number;
  /** Priced products whose price has not been refreshed in over 30 days. */
  staleOver30: number;
  staleOver90: number;
  medianAgeDays: number | null;
  oldestScrapedAt: Date | null;
  newestScrapedAt: Date | null;
  buckets: PriceAgeBucket[];
};

const BUCKET_DEFS: { key: string; label: string; minDays: number | null; maxDays: number | null }[] = [
  { key: "never", label: "Never scraped", minDays: null, maxDays: null },
  { key: "0_7", label: "0–7 days", minDays: 0, maxDays: 7 },
  { key: "8_30", label: "8–30 days", minDays: 7, maxDays: 30 },
  { key: "31_90", label: "31–90 days", minDays: 30, maxDays: 90 },
  { key: "91_180", label: "91–180 days", minDays: 90, maxDays: 180 },
  { key: "180_plus", label: "Over 180 days", minDays: 180, maxDays: null },
];

/**
 * How stale the prices we advertise actually are.
 *
 * The point of this report is to size the real problem before anyone argues
 * about auto-apply: a price nobody has verified in nine months is a bigger
 * risk than a price a guard would have adjusted by 3%. One query, bucketed in
 * JS — groupBy cannot express date ranges portably across SQLite and Postgres,
 * which this schema must both run on.
 */
export async function priceAgeReport(db: any): Promise<PriceAgeReport> {
  const now = new Date();
  const rows: { priceNow: number | null; lastScrapedAt: Date | null }[] = await db.product.findMany({
    where: { isVisible: true },
    select: { priceNow: true, lastScrapedAt: true },
  });

  const buckets: PriceAgeBucket[] = BUCKET_DEFS.map((d) => ({ ...d, count: 0, pricedCount: 0 }));
  const byKey = new Map<string, PriceAgeBucket>(buckets.map((b) => [b.key, b]));
  const ages: number[] = [];
  let totalPriced = 0;
  let staleOver30 = 0;
  let staleOver90 = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;

  for (const r of rows) {
    const priced = isPositive(r.priceNow);
    if (priced) totalPriced += 1;
    const d = asDate(r.lastScrapedAt);

    if (!d) {
      const b = byKey.get("never")!;
      b.count += 1;
      if (priced) {
        b.pricedCount += 1;
        staleOver30 += 1;
        staleOver90 += 1;
      }
      continue;
    }

    if (!oldest || d < oldest) oldest = d;
    if (!newest || d > newest) newest = d;

    const age = Math.max(0, daysBetween(now, d));
    ages.push(age);
    if (priced && age > 30) staleOver30 += 1;
    if (priced && age > 90) staleOver90 += 1;

    const def = BUCKET_DEFS.find((x) => x.minDays != null && age >= x.minDays && (x.maxDays == null || age <= x.maxDays));
    const b = byKey.get(def ? def.key : "180_plus")!;
    b.count += 1;
    if (priced) b.pricedCount += 1;
  }

  ages.sort((a, b) => a - b);
  const medianAgeDays = ages.length
    ? round2(ages.length % 2 ? ages[(ages.length - 1) / 2] : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2)
    : null;

  return {
    generatedAt: now,
    totalVisible: rows.length,
    totalPriced,
    neverScraped: byKey.get("never")!.count,
    staleOver30,
    staleOver90,
    medianAgeDays,
    oldestScrapedAt: oldest,
    newestScrapedAt: newest,
    buckets,
  };
}
