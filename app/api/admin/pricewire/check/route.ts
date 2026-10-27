import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { checkSite, FEED_BRANDS } from "@/lib/price-watch/pricewire";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Check": read a site live for one brand's products and record whether it
 * reads their prices correctly. Only a site that passed can then be picked
 * for that brand. Body: { siteId, brand }
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 12, bucket: "pricewire-check" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const brand = FEED_BRANDS.find((b) => b === body?.brand);
  if (!brand) return NextResponse.json({ error: "Pick Bosch, Neff or Siemens." }, { status: 400 });
  const db = await getPrisma();
  try {
    const r = await checkSite(db, String(body?.siteId || ""), brand);
    await writeAudit(db, { entityType: "pricewire-site", entityId: String(body.siteId), action: "pricewire:check", changedFields: [],
      previousValue: {}, newValue: { brand, passed: r.passed, summary: r.summary }, changedBy: gate.admin.email });
    return NextResponse.json(r);
  } catch (e: any) {
    const m = String(e?.message || e).slice(0, 160);
    return NextResponse.json({ error: /only sells/.test(m) ? m : `Could not check the site: ${m}` }, { status: /only sells/.test(m) ? 400 : 502 });
  }
}
