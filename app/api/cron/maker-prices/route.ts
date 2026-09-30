import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { cronAuthorised } from "@/lib/cron-auth";
import { readMakerPrices } from "@/lib/price-watch/maker-read";
import { autoApplySource } from "@/lib/price-watch/auto-apply";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every morning (vercel.json: 05:00–05:59 UTC, before the 06:00 summary):
 *   1. read Bosch's and Neff's own page for each of Sachin's best sellers
 *   2. let the price agent apply what they say — best sellers only, full guards
 * Step 2 changes nothing until the owner switches "manufacturer-rrp" to
 * automatic; until then it halts with the reason, and the reads still land in
 * Admin → Price watch. One "price-watch:maker-read" audit row per run.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  const read = await readMakerPrices(db).catch((e: any) => `failed: ${e?.message}`);
  const applied = await autoApplySource(db, { sourceId: "manufacturer-rrp", appliedBy: "price-agent (maker price, best sellers)" })
    .then((o) => (o.halted ? `held: ${o.haltReason}` : `${o.applied.length} applied, ${o.unchanged} unchanged, ${Object.values(o.refused).reduce((a, b) => a + b, 0)} held`))
    .catch((e: any) => `failed: ${e?.message}`);
  await writeAudit(db, {
    entityType: "price-source", entityId: "manufacturer-rrp", action: "price-watch:maker-read", changedFields: [],
    previousValue: {}, newValue: { read, applied }, changedBy: "price-agent (maker price, best sellers)",
  });
  return NextResponse.json({ ok: true, read, applied });
}
