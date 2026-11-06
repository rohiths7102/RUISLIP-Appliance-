import { writeAudit } from "@/lib/audit";
import { revalidateStorefront } from "@/lib/revalidate";
import { autoApplySource } from "@/lib/price-watch/auto-apply";
import { syncPricewire, type PricewireRun } from "@/lib/price-watch/pricewire";
import { runRules } from "@/lib/price-watch/pricing-rules";

/**
 * One Pricewire run: read, then let the price agent apply each site's reads
 * to the products that follow it, full guards and change budget. Shared by
 * the 05:00 cron and the n8n trigger (/api/price-ingest/pricewire), so both
 * leave the same "price-watch:maker-read" audit row the dashboard health
 * check reads.
 */
export async function runPricewire(db: any, opts: { deadlineMs: number; by: string }) {
  const read: PricewireRun | string = await syncPricewire(db, { deadlineMs: opts.deadlineMs }).catch((e: any) => `failed: ${e?.message}`);
  const applied: Record<string, string> = {};
  let changed = 0;
  const siteIds = typeof read === "string" ? [] : Object.keys(read.sites);
  for (const sourceId of siteIds) {
    applied[sourceId] = await autoApplySource(db, { sourceId, appliedBy: opts.by })
      .then((o) => { changed += o.applied.length; return o.halted ? `held: ${o.haltReason}` : `${o.applied.length} applied, ${o.unchanged} unchanged, ${Object.values(o.refused).reduce((a, b) => a + b, 0)} held`; })
      .catch((e: any) => `failed: ${e?.message}`);
  }
  if (changed) revalidateStorefront(["/products"], { allPages: true });
  // Pricing rules see the fresh reads; their suggestions wait in the review queue (nothing is applied here).
  const rules = await runRules(db, opts.by).then((r) => `${r.suggested} rule suggestions`).catch((e: any) => `rules failed: ${e?.message}`);
  const priced = typeof read === "string" ? 0 : Object.values(read.brands).reduce((a, t) => a + t.priced, 0);
  const summary = Object.entries(applied).map(([k, v]) => `${k}: ${v}`).join("; ") || "nothing read";
  await writeAudit(db, {
    entityType: "price-source", entityId: "pricewire", action: "price-watch:maker-read", changedFields: [],
    previousValue: {}, newValue: { read: typeof read === "string" ? read : { priced, ...read }, applied: summary, changed, rules },
    changedBy: opts.by,
  });
  return { read, applied, changed, rules };
}
