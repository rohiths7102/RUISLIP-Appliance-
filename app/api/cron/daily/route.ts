import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { adsApiConfigured, syncFromApi } from "@/lib/google-ads-api";
import { getSettings } from "@/lib/marketing/settings";
import { runAutoBlock } from "@/lib/marketing/automation";
import { buildWeeklyReport, sendReport } from "@/lib/marketing/report";
import { recomputeCounts } from "@/lib/counts";
import { indexNow } from "@/lib/indexnow";
import { SITE } from "@/lib/seo";
import { sendDailySummary } from "@/lib/price-watch/daily-summary";
import { cronAuthorised } from "@/lib/cron-auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The marketing engine's daily run (vercel.json cron, 06:00 UTC). In order:
 *   1. pull every Google Ads report over the API (so Admin → Today is fresh)
 *   2. auto-block clear waste — only if the owner switched it on
 *   3. on Mondays, email the weekly report — only if switched on
 *   4. delete chat conversations older than 12 months (the privacy notice's promise)
 *   5. recount every category and brand ("Search 5,100+ appliances", "343 models")
 *   6. tell Bing (IndexNow) which product pages changed since yesterday
 *   7. send the owner the morning price summary (WhatsApp + Admin → Price watch),
 *      which includes the best sellers' maker prices applied an hour earlier by
 *      /api/cron/maker-prices
 * Vercel calls it with "Authorization: Bearer $CRON_SECRET"; anything else is
 * refused. Each run leaves one "marketing:daily" audit row with what it did.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  const run: Record<string, unknown> = { at: new Date().toISOString() };

  if (adsApiConfigured()) {
    try { run.sync = await syncFromApi(db); } catch (e: any) { run.sync = `failed: ${e?.message}`; }
  } else run.sync = "skipped: Google isn't connected";

  const s = await getSettings(db);
  run.autoBlock = await runAutoBlock(db, s).catch((e: any) => ({ blocked: [], note: `failed: ${e?.message}` }));

  const monday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date()) === "Monday";
  if (monday && s.weeklyReport && s.reportTo) run.report = await sendReport(s.reportTo, await buildWeeklyReport(db));
  else run.report = monday ? "skipped: weekly report is off" : "not Monday";

  // Imports run by script skip the admin's recount: on 24 Sept the live header
  // said "1,900+ appliances" over 5,193 products. Once a day, whatever wrote them.
  run.counts = await Promise.all([db.category.findMany({ select: { name: true } }), db.brand.findMany({ select: { name: true } })])
    .then(([cats, brands]: any[]) => recomputeCounts(db, { categories: cats.map((c: any) => c.name), brands: brands.map((b: any) => b.name) }))
    .then(() => "recounted").catch((e: any) => `failed: ${e?.message}`);

  run.chatDeleted = await db.chatTurn.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * 86_400_000) } } })
    .then((r: any) => r.count).catch((e: any) => `failed: ${e?.message}`);

  // Prices change nightly; Bing and Copilot quote them, so they re-read those pages today.
  run.indexNow = await db.product.findMany({ where: { isVisible: true, updatedAt: { gte: new Date(Date.now() - 25 * 3_600_000) } }, select: { slug: true } })
    .then((ps: any[]) => indexNow(ps.map((p) => `${SITE().replace(/\/+$/, "")}/products/${p.slug}`)))
    .then((n: number) => `${n} pages`).catch((e: any) => `failed: ${e?.message}`);

  run.priceSummary = await sendDailySummary(db).then((r) => r.whatsapp).catch((e: any) => `failed: ${e?.message}`);

  await writeAudit(db, {
    entityType: "marketing", entityId: "daily", action: "marketing:daily", changedFields: [],
    previousValue: {}, newValue: run, changedBy: "marketing engine (daily)",
  });
  return NextResponse.json({ ok: true, ...run });
}
