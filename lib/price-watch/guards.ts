import { isPoaProduct } from "@/lib/poa";

/**
 * Price-watch guards.
 *
 * Pure functions only: no DB, no I/O, no clock reads that aren't injectable
 * (`now` is a parameter). Everything here is directly unit-testable, because
 * the one thing this module exists to prevent — advertising below cost — must
 * be provable by a test, not by reading the ingest route.
 *
 * The rule for every guard below: a guard either BLOCKS or it is decoration.
 * `warnings` is for things a human should look at; `blocking` is for things
 * that make an automatic price change impossible. Nothing that protects money
 * lives in `warnings`.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** UK standard rate. Advertised prices on the storefront are inc-VAT. */
export const DEFAULT_VAT_RATE = 0.2;
/** Minimum TRUE margin (share of the ex-VAT selling price we keep). */
export const DEFAULT_MIN_MARGIN_PCT = 0.12;
/** An observation older than this cannot justify a price change. */
export const DEFAULT_STALE_AFTER_DAYS = 7;
/** Scraper sanity threshold — see the `implausible_move` guard. */
export const DEFAULT_IMPLAUSIBLE_MOVE_PCT = 0.35;
/**
 * PriceObservation.matchConfidence below this came from fuzzy matching, i.e.
 * we are not certain it is even the same appliance.
 */
export const DEFAULT_MIN_MATCH_CONFIDENCE = 1;

export type GuardConfig = {
  vatRate: number;
  minMarginPct: number;
  staleAfterDays: number;
  implausibleMovePct: number;
  minMatchConfidence: number;
  /** Warn when the proposal clears the floor by less than this fraction of it. */
  thinMarginPct: number;
};

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  vatRate: DEFAULT_VAT_RATE,
  minMarginPct: DEFAULT_MIN_MARGIN_PCT,
  staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
  implausibleMovePct: DEFAULT_IMPLAUSIBLE_MOVE_PCT,
  minMatchConfidence: DEFAULT_MIN_MATCH_CONFIDENCE,
  thinMarginPct: 0.02,
};

/**
 * Every code this module can emit. `GuardResult` keeps `string[]` (the agreed
 * contract shape) so callers can render unknown future codes without a type
 * error; this union is the documentation of what they will actually see.
 */
export type GuardCode =
  // --- the eight required blocking guards -------------------------------
  | "below_floor"
  | "no_floor_data"
  | "vat_basis_mismatch"
  | "unknown_delivery"
  | "advisory_source"
  | "poa_category"
  | "stale_observation"
  | "implausible_move"
  // --- additional fail-safe blocks --------------------------------------
  | "invalid_proposal"
  | "unusable_observation"
  | "unconfirmed_match"
  | "source_auto_apply_disabled"
  | "poa_unknown"
  // --- warnings (never block on their own) ------------------------------
  | "no_current_price"
  | "out_of_stock"
  | "thin_margin"
  | "price_increase"
  | "auto_apply_flag_unknown"
  | "low_confidence_source_url";

/** Human-facing one-liners for the admin UI. Keyed by every code above. */
export const GUARD_REASONS: Record<GuardCode, string> = {
  below_floor: "Proposed price is below the floor (cost + minimum margin, inc-VAT).",
  no_floor_data: "No costPrice and no floorPrice — we cannot prove this price is profitable.",
  vat_basis_mismatch: "Source quotes ex-VAT but we advertise inc-VAT, and no VAT conversion was applied.",
  unknown_delivery: "Delivery cost is unknown, so the landed price cannot be compared.",
  advisory_source: "Advisory sources are for information only and can never auto-apply.",
  poa_category: "Product is in a price-on-application category and must never carry an applied price.",
  stale_observation: "Observation is older than the freshness window.",
  implausible_move: "Price move is too large to be trusted from a scrape.",
  invalid_proposal: "Proposed price is missing, zero, negative or not a finite number.",
  unusable_observation: "Observation did not complete successfully or carries no price.",
  unconfirmed_match: "Match confidence is below certainty — this may be a different appliance.",
  source_auto_apply_disabled: "This source is not permitted to auto-apply prices.",
  poa_unknown: "Price-on-application status is unknown for this product.",
  no_current_price: "Product has no current price to compare against.",
  out_of_stock: "Source reports the item as out of stock.",
  thin_margin: "Proposed price only just clears the floor.",
  price_increase: "Proposal raises the price rather than lowering it.",
  auto_apply_flag_unknown: "Source auto-apply permission was not supplied.",
  low_confidence_source_url: "Observation has no source URL to audit against.",
};

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/** The parts of a PriceObservation the guards actually reason about. */
export type GuardObservation = {
  /** Headline price as the source stated it, on the source's own VAT basis. */
  price: number | null;
  /** null means UNKNOWN, never free. */
  deliveryCost: number | null;
  inStock: boolean | null;
  /** Whether `price` is VAT-inclusive, copied from the source at observe time. */
  includesVat: boolean;
  matchConfidence: number;
  /** "ok" | "blocked" | "not_found" | "parse_failed" */
  status: string;
  sourceUrl?: string;
  observedAt: Date;
};

export type Proposal = {
  productId: string;
  /** Our advertised price today, inc-VAT. null when we have never priced it. */
  currentPrice: number | null;
  /** The price we would advertise, inc-VAT, after any VAT conversion. */
  proposedPrice: number;
  sourceId: string;
  /** "authorised" | "advisory" — PriceSource.kind. */
  sourceKind: string;
  /** PriceSource.allowAutoApply. Omitted = unknown, which is not a yes. */
  sourceAllowsAutoApply?: boolean;
  /**
   * True when the caller has already converted an ex-VAT observation onto our
   * inc-VAT basis. Without this the `vat_basis_mismatch` guard has no way to
   * tell "converted" from "silently 20% under-priced".
   */
  vatConversionApplied?: boolean;
  observation: GuardObservation;
};

export type GuardProduct = {
  /** Ex-VAT unit cost. */
  costPrice: number | null;
  /** Explicit inc-VAT "never advertise below this" override. */
  floorPrice: number | null;
  category?: string | null;
  subcategory?: string | null;
  /** Pre-computed POA flag; wins over `poaNames` when supplied. */
  isPoa?: boolean;
};

export type GuardInput = {
  proposal: Proposal;
  product: GuardProduct;
  /** From poaNamesFromDb(db). Required unless product.isPoa is supplied. */
  poaNames?: Set<string> | null;
  config?: Partial<GuardConfig>;
  /** Injectable clock, so staleness is testable. */
  now?: Date;
};

export type GuardResult = {
  allowed: boolean;
  blocking: string[];
  warnings: string[];
  /** The inc-VAT floor used, or null when it could not be computed. */
  floor: number | null;
};

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Treat 0, negatives, NaN and null alike: "we do not have this number". */
const positiveOrNull = (n: number | null | undefined): number | null => (isPositive(n) ? n : null);

/**
 * Round a floor UP to the penny. Rounding to nearest would let a price one
 * fraction of a penny under cost pass the very guard that exists to stop it.
 */
const ceilPenny = (n: number): number => Math.ceil(n * 100 - 1e-9) / 100;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

/**
 * The lowest inc-VAT price we may advertise.
 *
 * MARGIN MATHS — named honestly. `minMarginPct` is a TRUE margin: the share of
 * our own ex-VAT selling price that we keep. It is NOT a markup on cost. The
 * previous design shipped `cost * (1 + pct)` under the label "margin", which
 * silently realises a smaller margin than the number configured.
 *
 *     floor_ex_vat = cost / (1 - minMarginPct)
 *     floor        = floor_ex_vat * (1 + vatRate)
 *
 * WORKED EXAMPLE — cost = 100.00, minMarginPct = 0.12, vatRate = 0.20:
 *
 *     floor_ex_vat = 100 / (1 - 0.12) = 100 / 0.88 = 113.6364
 *     realised margin = (113.6364 - 100) / 113.6364
 *                     =  13.6364        / 113.6364
 *                     =  0.12  exactly  =  the configured 12%.   PROVED.
 *     floor = 113.6364 * 1.20 = 136.36 inc-VAT
 *
 * The same numbers under the old markup formula: 100 * 1.12 = 112.00 ex-VAT,
 * whose realised margin is 12 / 112 = 10.71% — a 1.29 point shortfall on every
 * unit, widening as the configured percentage rises. Hence the division.
 *
 * Algebraic proof for any p in [0, 1):
 *     price = c / (1 - p)
 *     margin = (price - c) / price = 1 - c/price = 1 - (1 - p) = p.
 *
 * The floor is then rounded UP to the penny, so the realised margin at the
 * floor is >= the configured percentage (136.37 gives 12.004%), never under.
 *
 * When BOTH a derived floor and an explicit `floorPrice` exist we take the
 * HIGHER. `floorPrice` is documented as an override, but an override written
 * last year cannot license selling under this year's cost — the binding
 * constraint is whichever floor is higher, always.
 */
export function effectiveFloor(input: {
  costPrice: number | null;
  floorPrice: number | null;
  minMarginPct: number;
  vatRate: number;
}): number | null {
  const cost = positiveOrNull(input.costPrice);
  const explicit = positiveOrNull(input.floorPrice);

  // A margin of 1.0 would divide by zero and a margin above 1.0 would flip the
  // sign, producing a NEGATIVE floor that lets everything through. Clamp.
  const rawMargin = typeof input.minMarginPct === "number" && Number.isFinite(input.minMarginPct) ? input.minMarginPct : DEFAULT_MIN_MARGIN_PCT;
  const margin = Math.min(Math.max(rawMargin, 0), 0.95);

  const rawVat = typeof input.vatRate === "number" && Number.isFinite(input.vatRate) && input.vatRate >= 0 ? input.vatRate : DEFAULT_VAT_RATE;

  const derived = cost === null ? null : ceilPenny((cost / (1 - margin)) * (1 + rawVat));

  if (derived === null && explicit === null) return null;
  if (derived === null) return explicit;
  if (explicit === null) return derived;
  return Math.max(derived, explicit);
}

/**
 * The realised true margin of an inc-VAT selling price, for display next to a
 * proposal. Returns null when cost is unknown. Inverse of `effectiveFloor`.
 */
export function realisedMarginPct(input: { costPrice: number | null; incVatPrice: number; vatRate?: number }): number | null {
  const cost = positiveOrNull(input.costPrice);
  if (cost === null || !isPositive(input.incVatPrice)) return null;
  const vat = typeof input.vatRate === "number" && Number.isFinite(input.vatRate) && input.vatRate >= 0 ? input.vatRate : DEFAULT_VAT_RATE;
  const exVat = input.incVatPrice / (1 + vat);
  if (exVat <= 0) return null;
  return (exVat - cost) / exVat;
}

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

/**
 * Evaluate every guard against one proposal.
 *
 * Guards are all evaluated — we never short-circuit — so the admin UI can show
 * the owner every reason at once instead of one reason per re-run.
 */
export function evaluateGuards(input: GuardInput): GuardResult {
  const cfg: GuardConfig = { ...DEFAULT_GUARD_CONFIG, ...(input.config || {}) };
  const now = input.now || new Date();
  const { proposal, product } = input;
  const obs = proposal.observation;

  const blocking: GuardCode[] = [];
  const warnings: GuardCode[] = [];

  const floor = effectiveFloor({
    costPrice: product.costPrice,
    floorPrice: product.floorPrice,
    minMarginPct: cfg.minMarginPct,
    vatRate: cfg.vatRate,
  });

  // --- 0. The proposal itself must be a real number ------------------------
  const proposed = isPositive(proposal.proposedPrice) ? proposal.proposedPrice : null;
  if (proposed === null) blocking.push("invalid_proposal");

  // --- 1. below_floor — THE critical guard ---------------------------------
  // A penny of float noise must not be treated as a breach, but nothing wider
  // than that is tolerated.
  if (proposed !== null && floor !== null && proposed < floor - 0.005) blocking.push("below_floor");

  // --- 2. no_floor_data ----------------------------------------------------
  // No cost and no explicit floor means there is no arithmetic anywhere that
  // can show this price is profitable. Auto-apply is impossible, permanently —
  // not "until a percentage-drop check passes".
  if (floor === null) blocking.push("no_floor_data");

  // --- 3. vat_basis_mismatch ----------------------------------------------
  // We advertise inc-VAT. A trade (ex-VAT) quote taken literally under-prices
  // by the whole VAT rate. Unknown basis is treated as mismatched.
  const basisKnown = typeof obs.includesVat === "boolean";
  if (!basisKnown || (obs.includesVat === false && proposal.vatConversionApplied !== true)) {
    blocking.push("vat_basis_mismatch");
  }

  // --- 4. unknown_delivery -------------------------------------------------
  // deliveryCost null means UNKNOWN, never free. Comparing a landed price we
  // cannot compute is guesswork, so no source with a missing delivery figure
  // may drive a change.
  //
  // Deliberately NOT conditioned on sourceKind. Guard 5 already blocks every
  // non-authorised source outright, so gating this one on "advisory only" made
  // it unreachable decoration: it could never change a verdict, and never fired
  // for the authorised sources that are the only ones able to move a price.
  if (obs.deliveryCost == null) blocking.push("unknown_delivery");

  // --- 5. advisory_source --------------------------------------------------
  // Only an authorised source (our own distributor feeds) may ever move a
  // price automatically. Everything else is intelligence for a human.
  if (proposal.sourceKind !== "authorised") blocking.push("advisory_source");

  // The per-source switch is a second, independent lock on the same door.
  if (proposal.sourceAllowsAutoApply === false) blocking.push("source_auto_apply_disabled");
  else if (typeof proposal.sourceAllowsAutoApply !== "boolean") warnings.push("auto_apply_flag_unknown");

  // --- 6. poa_category -----------------------------------------------------
  // POA is a standing owner instruction: these categories must NEVER receive
  // an applied price. Reuses lib/poa.ts so there is exactly one definition of
  // "call for price" in the codebase (which includes its degraded-catalogue
  // fallback). If we cannot determine POA status at all we block: an unknown
  // here is not permission.
  if (typeof product.isPoa === "boolean") {
    if (product.isPoa) blocking.push("poa_category");
  } else if (input.poaNames instanceof Set) {
    if (isPoaProduct(input.poaNames, { category: product.category, subcategory: product.subcategory })) {
      blocking.push("poa_category");
    }
  } else {
    blocking.push("poa_unknown");
  }

  // --- 7. stale_observation ------------------------------------------------
  const observedAt = obs.observedAt instanceof Date ? obs.observedAt : new Date(obs.observedAt as unknown as string);
  const ageDays = Number.isFinite(observedAt.getTime()) ? (now.getTime() - observedAt.getTime()) / DAY_MS : Number.POSITIVE_INFINITY;
  if (!(ageDays <= cfg.staleAfterDays)) blocking.push("stale_observation");

  // --- 8. implausible_move -------------------------------------------------
  // A SCRAPER SANITY CHECK, EXPLICITLY NOT A MARGIN CONTROL. It catches a
  // parser that grabbed the accessory price, the finance instalment or the
  // ex-VAT figure — i.e. a broken scrape. It says nothing whatsoever about
  // whether a price is profitable; `below_floor` is the only guard that does,
  // and this one must never be used as a substitute for it.
  if (proposed !== null && isPositive(proposal.currentPrice)) {
    const move = Math.abs(proposed - proposal.currentPrice) / proposal.currentPrice;
    if (move > cfg.implausibleMovePct) blocking.push("implausible_move");
  }

  // --- additional fail-safe blocks ----------------------------------------
  // A failed run is recorded rather than dropped, so it reaches here; it must
  // not be mistaken for a price.
  if (obs.status !== "ok" || obs.price == null) blocking.push("unusable_observation");

  // Below certainty the row came from fuzzy matching and may be a different
  // appliance — a wrong product's price is a wrong price.
  const confidence = typeof obs.matchConfidence === "number" && Number.isFinite(obs.matchConfidence) ? obs.matchConfidence : 0;
  if (confidence < cfg.minMatchConfidence) blocking.push("unconfirmed_match");

  // --- warnings ------------------------------------------------------------
  if (!isPositive(proposal.currentPrice)) warnings.push("no_current_price");
  if (obs.inStock === false) warnings.push("out_of_stock");
  if (!obs.sourceUrl) warnings.push("low_confidence_source_url");
  if (proposed !== null && floor !== null && proposed >= floor && proposed < floor * (1 + cfg.thinMarginPct)) {
    warnings.push("thin_margin");
  }
  if (proposed !== null && isPositive(proposal.currentPrice) && proposed > proposal.currentPrice) {
    warnings.push("price_increase");
  }

  // Stable, de-duplicated ordering so snapshots and UI lists do not churn.
  const order = (c: GuardCode): number => GUARD_ORDER.indexOf(c);
  const dedupeSort = (xs: GuardCode[]): string[] => Array.from(new Set(xs)).sort((a, b) => order(a) - order(b));

  return {
    allowed: blocking.length === 0,
    blocking: dedupeSort(blocking),
    warnings: dedupeSort(warnings),
    floor,
  };
}

const GUARD_ORDER: GuardCode[] = [
  "below_floor",
  "no_floor_data",
  "vat_basis_mismatch",
  "unknown_delivery",
  "advisory_source",
  "poa_category",
  "stale_observation",
  "implausible_move",
  "invalid_proposal",
  "unusable_observation",
  "unconfirmed_match",
  "source_auto_apply_disabled",
  "poa_unknown",
  "no_current_price",
  "out_of_stock",
  "thin_margin",
  "price_increase",
  "auto_apply_flag_unknown",
  "low_confidence_source_url",
];

/** A GuardResult for a product we have no usable observation for at all. */
export function noObservationResult(floor: number | null): GuardResult {
  return { allowed: false, blocking: ["unusable_observation"], warnings: [], floor };
}

/** Render codes for the admin UI without every caller re-importing the map. */
export const explainGuard = (code: string): string => GUARD_REASONS[code as GuardCode] || code;
