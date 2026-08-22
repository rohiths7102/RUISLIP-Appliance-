import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { DEFAULT_GUARD_CONFIG, evaluateGuards } from "@/lib/price-watch/guards";
import {
  priceWatchRows,
  type LatestObservation,
  type PriceWatchRow as QueryRow,
} from "@/lib/price-watch/queries";
import AdminShell from "@/components/admin/AdminShell";
import PriceWatchAdmin, {
  type PriceWatchGuards,
  type PriceWatchObservation,
  type PriceWatchRow,
  type PriceWatchSource,
  type AutoChange,
} from "@/components/admin/PriceWatchAdmin";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Formatted on the server so a timezone difference between the server and the
 * owner's browser cannot cause a hydration mismatch — and so he reads
 * "seen 2 days ago" rather than an ISO timestamp.
 */
function seenLabel(d: Date, now: number): string {
  const days = Math.floor((now - d.getTime()) / DAY);
  if (days <= 0) return "seen today";
  if (days === 1) return "seen yesterday";
  if (days < 14) return `seen ${days} days ago`;
  return `seen ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * The guard verdict for ONE source's observation.
 *
 * priceWatchRows computes `guardResult` only for its own `reference` pick (the
 * cheapest usable price across every source). This screen lets the owner look
 * at one named source at a time, so each source's observation needs its own
 * verdict — otherwise a row would show the cheapest shop's reasons next to a
 * different shop's price, which is exactly the kind of quiet mismatch that gets
 * a wrong price applied.
 *
 * The proposal is built from `normalisedPrice` (inc-VAT, VAT-converted where
 * needed) because that is the number that would actually be advertised, and
 * `vatConversionApplied` is passed through so the vat_basis_mismatch guard can
 * tell a converted trade price from one silently 20% under.
 */
function guardsFor(row: QueryRow, o: LatestObservation, now: Date): PriceWatchGuards {
  if (o.normalisedPrice == null) {
    return { allowed: false, blocking: ["unusable_observation"], warnings: [], floor: row.floor };
  }
  try {
    const g = evaluateGuards({
      proposal: {
        productId: row.productId,
        currentPrice: row.ourPrice,
        proposedPrice: o.normalisedPrice,
        sourceId: o.sourceId,
        sourceKind: o.sourceKind,
        sourceAllowsAutoApply: o.sourceAllowsAutoApply,
        vatConversionApplied: o.vatConverted,
        observation: {
          price: o.price,
          deliveryCost: o.deliveryCost,
          inStock: o.inStock,
          includesVat: o.includesVat,
          matchConfidence: o.matchConfidence,
          status: o.status,
          sourceUrl: o.sourceUrl,
          observedAt: o.observedAt,
        },
      },
      product: {
        costPrice: row.costPrice,
        floorPrice: row.floorPrice,
        category: row.category,
        subcategory: row.subcategory,
        isPoa: row.isPoa,
      },
      config: DEFAULT_GUARD_CONFIG,
      now,
    });
    return { allowed: g.allowed, blocking: g.blocking, warnings: g.warnings, floor: g.floor };
  } catch {
    // Fail CLOSED. A guard module that throws must never leave a row looking safe.
    return { allowed: false, blocking: ["guard_error"], warnings: [], floor: row.floor };
  }
}

export default async function AdminPriceWatch() {
  const admin = await requireAdmin();

  let rows: PriceWatchRow[] = [];
  let sources: PriceWatchSource[] = [];
  let autoChanges: AutoChange[] = [];
  let dbUp = true;

  try {
    const db = await getPrisma();
    const nowDate = new Date();
    const now = nowDate.getTime();

    const [queryRows, rawSources] = await Promise.all([
      priceWatchRows(db, { limit: 300 }),
      db.priceSource.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] }),
    ]);

    sources = (rawSources as any[]).map((s) => ({
      id: String(s.id),
      label: String(s.label || s.id),
      kind: String(s.kind || "advisory"),
      enabled: Boolean(s.enabled),
      allowAutoApply: Boolean(s.allowAutoApply),
      lastRunLabel: s.lastRunAt
        ? `last checked ${seenLabel(new Date(s.lastRunAt), now).replace(/^seen /, "")}`
        : "never checked",
      lastRunStatus: String(s.lastRunStatus || ""),
    }));

    // The agent's recent work, straight from the audit trail — the same rows a
    // dispute would be settled from, not a separate "activity" table that could
    // drift from reality.
    const autoAudit = await db.adminAuditLog.findMany({
      where: { action: "price-watch:auto-apply" },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    const productIds = [...new Set(autoAudit.map((a: any) => String(a.entityId)))] as string[];
    const auditProducts = productIds.length
      ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, productCode: true } })
      : [];
    const byId = new Map((auditProducts as any[]).map((p) => [p.id, p]));
    autoChanges = autoAudit.map((a: any) => {
      const p = byId.get(String(a.entityId));
      const prev = (a.previousValue || {}) as any;
      const next = (a.newValue || {}) as any;
      return {
        when: seenLabel(new Date(a.createdAt), now),
        title: p?.title || "(deleted product)",
        productCode: p?.productCode || "",
        from: typeof prev.priceNow === "number" ? prev.priceNow : null,
        to: typeof next.priceNow === "number" ? next.priceNow : null,
        sourceLabel: String(next.sourceLabel || next.sourceId || ""),
      };
    });

    rows = queryRows.map((r) => {
      const observations: PriceWatchObservation[] = r.observations.map((o) => ({
        sourceId: o.sourceId,
        sourceLabel: o.sourceLabel,
        sourceKind: o.sourceKind,
        // The inc-VAT, comparable number — never the source's raw figure, which
        // may be a trade (ex-VAT) quote.
        price: o.normalisedPrice,
        rawPrice: o.price,
        vatConverted: o.vatConverted,
        deliveryCost: o.deliveryCost,
        landedPrice: o.landedPrice,
        inStock: o.inStock,
        sourceUrl: o.sourceUrl,
        status: o.status,
        observedAt: o.observedAt.toISOString(),
        seenLabel: seenLabel(o.observedAt, now),
        guards: guardsFor(r, o, nowDate),
      }));

      return {
        productId: r.productId,
        title: r.title,
        productCode: r.productCode,
        brand: r.brand,
        category: r.category,
        subcategory: r.subcategory,
        slug: r.slug,
        priceNow: r.ourPrice,
        costPrice: r.costPrice,
        floor: r.floor,
        observations,
      };
    });
  } catch (e) {
    console.error("price-watch page", e);
    dbUp = false;
  }

  return (
    <AdminShell active="/admin/price-watch" email={admin.email}>
      <PriceWatchAdmin rows={rows} sources={sources} autoChanges={autoChanges} dbUp={dbUp} />
    </AdminShell>
  );
}
