import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncPricewire } from "@/lib/price-watch/pricewire";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Read prices now": the same read as the 05:00 run, for up to ~45 seconds.
 * A price list is one request; product pages not reached in time are read
 * first on the next press. Reads only — nothing is applied here.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 6, bucket: "pricewire-run" });
  if ("response" in gate) return gate.response;
  const db = await getPrisma();
  const run = await syncPricewire(db, { deadlineMs: 45_000 });
  await writeAudit(db, {
    entityType: "price-source", entityId: "pricewire", action: "pricewire:read", changedFields: [],
    previousValue: {}, newValue: { ...run, summary: Object.entries(run.brands).map(([b, t]) => `${b}: ${t.priced}/${t.products} priced`).join(", ") }, changedBy: gate.admin.email,
  });
  return NextResponse.json(run);
}
