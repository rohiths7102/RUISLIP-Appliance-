import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { adsApiConfigured, syncFromApi } from "@/lib/google-ads-api";
import { getSettings } from "@/lib/marketing/settings";
import { runAutoBlock } from "@/lib/marketing/automation";
import { buildWeeklyReport, sendReport } from "@/lib/marketing/report";
import { recomputeCounts } from "@/lib/counts";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The marketing engine's daily run (vercel.json cron, 06:00 UTC). In order:
 *   1. pull every Google Ads report over the API (so Admin → Today is fresh)
 *   2. auto-block clear waste — only if the owner switched it on
 *   3. on Mondays, email the weekly report — only if switched on
 *   4. delete chat conversations older than 12 months (the privacy notice's promise)
 *   5. recount every category and brand ("Search 5,100+ appliances", "343 models")
 * Vercel calls it with "Authorization: Bearer $CRON_SECRET"; anything else is
 * refused. Each run leaves one "marketing:daily" audit row with what it did.
 */
function authorised(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (secret.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  await writeAudit(db, {
    entityType: "marketing", entityId: "daily", action: "marketing:daily", changedFields: [],
    previousValue: {}, newValue: run, changedBy: "marketing engine (daily)",
  });
  return NextResponse.json({ ok: true, ...run });
}
