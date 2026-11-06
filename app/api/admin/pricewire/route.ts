import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ensurePricewire, checkPassed, brandsForSite, CHECK_VALID_DAYS, FEED_BRANDS } from "@/lib/price-watch/pricewire";
export const dynamic = "force-dynamic";

/**
 * Save one brand's Pricewire choice: the site its prices come from, a backup
 * site for models the first has no price for, and whether it runs at all.
 * A site newly picked for a brand must have passed its check for that brand
 * in the last few days (lib/price-watch/pricewire.ts checkSite), so a site
 * that cannot read this brand's prices never gets chosen. Audit-logged.
 * Body: { brand, siteId, fallbackSiteId, enabled }
 */
export async function PATCH(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, bucket: "pricewire" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const brand = FEED_BRANDS.find((b) => b === body?.brand);
  if (!brand) return NextResponse.json({ error: "Pick Bosch, Neff or Siemens." }, { status: 400 });
  const db = await getPrisma();
  await ensurePricewire(db);
  const siteId = String(body.siteId || "").trim();
  const fallbackSiteId = String(body.fallbackSiteId || "").trim();
  const known = new Set((await db.priceSite.findMany({ select: { id: true } })).map((s: any) => s.id));
  if (!known.has(siteId)) return NextResponse.json({ error: "Choose a site for this brand." }, { status: 400 });
  if (fallbackSiteId && !known.has(fallbackSiteId)) return NextResponse.json({ error: "That backup site does not exist." }, { status: 400 });
  if (fallbackSiteId === siteId) return NextResponse.json({ error: "The backup site must be a different site." }, { status: 400 });

  const before = await db.brandPriceFeed.findUnique({ where: { brand } });
  const names = new Map((await db.priceSite.findMany({ select: { id: true, name: true } })).map((s: any) => [s.id, s.name]));
  for (const id of [siteId, fallbackSiteId]) {
    if (!id || id === before.siteId || id === before.fallbackSiteId) continue;
    if (!brandsForSite(id).includes(brand)) return NextResponse.json({ error: `The ${names.get(id)} site only sells ${brandsForSite(id).join(", ")}.` }, { status: 400 });
    if (!(await checkPassed(db, id, brand))) {
      return NextResponse.json({ error: `${names.get(id)} hasn't passed its ${brand} check in the last ${CHECK_VALID_DAYS} days. Press Check next to it, then save.` }, { status: 400 });
    }
  }
  const data = { siteId, fallbackSiteId, enabled: body.enabled !== false };
  const after = await db.brandPriceFeed.update({ where: { brand }, data });
  const changed = Object.keys(data).filter((k) => (before as any)[k] !== (data as any)[k]);
  // New sites for a brand: every product is due now, so the next read asks the new sites rather than waiting out the old schedule.
  if (changed.includes("siteId") || changed.includes("fallbackSiteId") || changed.includes("enabled")) {
    await db.brandPriceItem.updateMany({ where: { brand }, data: { nextCheckAt: null } });
  }
  if (changed.length) {
    await writeAudit(db, {
      entityType: "pricewire-brand", entityId: brand, action: "pricewire:settings", changedFields: changed,
      previousValue: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])), newValue: Object.fromEntries(changed.map((k) => [k, (data as any)[k]])),
      changedBy: gate.admin.email,
    });
  }
  return NextResponse.json({ ok: true, feed: after });
}
