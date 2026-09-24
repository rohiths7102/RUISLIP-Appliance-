import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/marketing/settings";
import { buildWeeklyReport, sendReport } from "@/lib/marketing/report";
export const dynamic = "force-dynamic";

/**
 * Admin → Today:
 *   { action: "settings", value: MarketingSettings }   switches and thresholds
 *   { action: "dismiss", key, days? }                   hide an action (default 30 days)
 *   { action: "send_report" }                           email the weekly report now
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  try {
    if (body.action === "settings") {
      const before = await getSettings(db);
      // Merge: the Today page sends everything, the dashboard's targets card only its part.
      const after = await saveSettings(db, { ...before, ...(body.value || {}), targets: { ...before.targets, ...(body.value?.targets || {}) } });
      await writeAudit(db, { entityType: "marketing", entityId: "settings", action: "marketing:settings", changedFields: Object.keys(after).filter((k) => (before as any)[k] !== (after as any)[k]), previousValue: before, newValue: after, changedBy: gate.admin.email });
      return NextResponse.json(after);
    }
    if (body.action === "dismiss") {
      const key = String(body.key || "").slice(0, 300);
      if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
      const days = Math.min(Math.max(Number(body.days) || 30, 1), 365);
      const until = new Date(Date.now() + days * 86_400_000);
      await db.actionDismissal.upsert({ where: { key }, create: { key, until, dismissedBy: gate.admin.email }, update: { until, dismissedBy: gate.admin.email } });
      return NextResponse.json({ ok: true, until });
    }
    if (body.action === "send_report") {
      const s = await getSettings(db);
      if (!s.reportTo) return NextResponse.json({ error: "Set the email address first." }, { status: 400 });
      const res = await sendReport(s.reportTo, await buildWeeklyReport(db));
      return res.sent ? NextResponse.json({ ok: true, via: res.via }) : NextResponse.json({ error: res.reason }, { status: 502 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("admin marketing", e);
    return NextResponse.json({ error: "Could not save. Is the database running?" }, { status: 500 });
  }
}
