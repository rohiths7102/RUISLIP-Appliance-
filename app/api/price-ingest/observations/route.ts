import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { verifyMachineRequest, readRawBody, keyMaySourceWrite } from "@/lib/machine-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/price-ingest/observations
 *
 * The collector's write endpoint. It APPENDS what a source was seen to be
 * charging at a moment in time, and nothing else.
 *
 * IT NEVER WRITES Product.priceNow — nor costPrice, floorPrice or any other
 * customer-facing field. Observing a price and adopting a price are separate
 * acts with separate authority: adoption runs through the floor/margin guards in
 * lib/price-watch/guards.ts and (for advisory sources) a human. If this handler
 * could touch priceNow, a compromised collector key or a mis-parsed competitor
 * page would move the shop's advertised prices directly, below cost, with no
 * guard in the path. Keep every write in this file inside priceObservation and
 * priceSource.lastRun*.
 *
 * Auth: HMAC per lib/machine-auth.ts, route name "observations".
 */

const MAX_OBSERVATIONS = 500;
const MAX_PRICE = 100000; // £100k — nothing in a domestic appliance catalogue is above this
const VALID_STATUS = new Set(["ok", "blocked", "not_found", "parse_failed"]);

type Incoming = {
  productId?: unknown;
  productCode?: unknown;
  price?: unknown;
  deliveryCost?: unknown;
  inStock?: unknown;
  sourceUrl?: unknown;
  matchConfidence?: unknown;
  status?: unknown;
  note?: unknown;
};

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Money in, or null when absent/blank. `null` means UNKNOWN, never zero. */
function optionalNumber(v: unknown): number | null {
  // Number(" "), Number(false), Number([]) are all 0. Routed through the old
  // implementation a blank or boolean deliveryCost became a hard £0.00 — i.e.
  // "free delivery" asserted as fact — which is the one invariant this stack
  // repeats everywhere: null means UNKNOWN, never free.
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null; // booleans, arrays, objects: unknown
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  // Raw body FIRST — the signature covers these exact bytes, so nothing may
  // consume or re-serialise the stream before verification.
  const rawBody = await readRawBody(req);
  const auth = verifyMachineRequest(req, rawBody, "observations");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: any;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const sourceId = str(body?.sourceId, 100);
  const incoming: Incoming[] = Array.isArray(body?.observations) ? body.observations : [];
  if (!sourceId) return NextResponse.json({ error: "Missing sourceId" }, { status: 400 });
  // sourceId comes from the BODY, so a valid signature alone must not let a key
  // attribute its numbers to a source it does not own — an `authorised` source
  // is the only kind that can ever move a price.
  if (!keyMaySourceWrite(auth.keyId, sourceId)) {
    return NextResponse.json(
      { error: `Key "${auth.keyId}" may not write to source "${sourceId}"` },
      { status: 403 },
    );
  }
  if (!Array.isArray(body?.observations)) {
    return NextResponse.json({ error: "observations must be an array" }, { status: 400 });
  }
  if (incoming.length > MAX_OBSERVATIONS) {
    // 413, not a silent truncation: a worker that posts 900 rows and is told
    // "500 accepted" would believe the other 400 were recorded.
    return NextResponse.json(
      { error: `Too many observations (${incoming.length}); max ${MAX_OBSERVATIONS} per request` },
      { status: 413 },
    );
  }

  try {
    const db = await getPrisma();

    const source = await db.priceSource.findUnique({ where: { id: sourceId } });
    if (!source || !source.enabled) {
      return NextResponse.json({ error: "Unknown or disabled source" }, { status: 404 });
    }

    // Resolve every product reference in ONE round trip rather than per row.
    const ids = Array.from(new Set(incoming.map((o) => str(o.productId, 100)).filter(Boolean)));
    const codes = Array.from(new Set(incoming.map((o) => str(o.productCode, 100)).filter(Boolean)));
    const matches: { id: string; productCode: string }[] =
      ids.length || codes.length
        ? await db.product.findMany({
            where: { OR: [{ id: { in: ids } }, { productCode: { in: codes } }] },
            select: { id: true, productCode: true },
          })
        : [];

    const knownIds = new Set(matches.map((p) => p.id));
    // productCode is indexed but NOT unique in this catalogue. A code that hits
    // more than one product is treated as unresolved, not "first wins" — hanging
    // a competitor's price on the wrong product is worse than a skipped row.
    const byCode = new Map<string, string | null>();
    for (const p of matches) {
      const code = (p.productCode || "").trim();
      if (!code) continue;
      byCode.set(code, byCode.has(code) ? null : p.id);
    }

    const now = new Date();
    const rows: any[] = [];
    const byStatus: Record<string, number> = {};
    const unresolved: { productId?: string; productCode?: string; reason: string }[] = [];
    const bump = (s: string) => { byStatus[s] = (byStatus[s] || 0) + 1; };

    for (const o of incoming) {
      const givenId = str(o.productId, 100);
      const givenCode = str(o.productCode, 100);
      const productId = givenId && knownIds.has(givenId) ? givenId : givenCode ? byCode.get(givenCode) ?? null : null;

      if (!productId) {
        // PriceObservation.productId is a required FK, so a row that matches no
        // product CANNOT be persisted. It is reported back as "not_found"
        // instead of throwing, so one unmatched SKU never fails a whole batch —
        // the collector sees exactly which references it should stop sending.
        bump("not_found");
        unresolved.push({
          ...(givenId ? { productId: givenId } : {}),
          ...(givenCode ? { productCode: givenCode } : {}),
          reason: givenCode && byCode.get(givenCode) === null ? "ambiguous_product_code" : "not_found",
        });
        continue;
      }

      let status = VALID_STATUS.has(str(o.status, 40)) ? str(o.status, 40) : "ok";
      let note = str(o.note, 500);

      // A price is either plausible or it is not stored. Persisting 0.01 or
      // 4_500_000 from a mis-parsed page would poison the trend history that the
      // guards and the admin review screen read.
      let price = optionalNumber(o.price);
      const priceGiven = o.price !== null && o.price !== undefined && o.price !== "";
      if (priceGiven && (price === null || price <= 0 || price > MAX_PRICE)) {
        note = `raw price: ${JSON.stringify(o.price)}${note ? ` | ${note}` : ""}`.slice(0, 500);
        price = null;
        status = "parse_failed";
      }

      let deliveryCost = optionalNumber(o.deliveryCost);
      // Unknown delivery stays null (the guards refuse to auto-apply on it);
      // negative or absurd values are unknown too, not a discount.
      if (deliveryCost !== null && (deliveryCost < 0 || deliveryCost > MAX_PRICE)) deliveryCost = null;

      const confidence = optionalNumber(o.matchConfidence);

      rows.push({
        productId,
        sourceId,
        price,
        deliveryCost,
        inStock: typeof o.inStock === "boolean" ? o.inStock : null,
        // Copied from the source AT WRITE TIME. If someone later flips the
        // source's priceIncludesVat, history keeps the basis it was read under —
        // otherwise every old row silently changes meaning by 20%.
        includesVat: !!source.priceIncludesVat,
        sourceUrl: str(o.sourceUrl, 1000),
        matchConfidence: confidence === null ? 0 : Math.min(Math.max(confidence, 0), 1),
        status,
        note,
        observedAt: now,
      });
      bump(status);
    }

    if (rows.length) await db.priceObservation.createMany({ data: rows });

    const accepted = rows.length;
    const rejected = unresolved.length;
    const runStatus = `${accepted} stored, ${rejected} unresolved, ${byStatus.parse_failed || 0} parse_failed`;
    await db.priceSource.update({
      where: { id: sourceId },
      // lastRunStatus records a bad run as loudly as a good one: a dead scraper
      // that posts zero rows must not look the same as stable prices.
      data: { lastRunAt: now, lastRunStatus: runStatus.slice(0, 200) },
    });

    return NextResponse.json({
      accepted,
      rejected,
      bySource: {
        [sourceId]: {
          label: source.label,
          kind: source.kind,
          includesVat: !!source.priceIncludesVat,
          accepted,
          rejected,
          byStatus,
          unresolved: unresolved.slice(0, 50), // enough to debug, not enough to bloat the response
        },
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
