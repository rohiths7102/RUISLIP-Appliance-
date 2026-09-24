import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import AdminShell from "@/components/admin/AdminShell";
import { Card, KpiTile, Notice, PageTitle } from "@/components/admin/ui";
import { ActionList, EngineSettings } from "@/components/admin/TodayPanel";
import { kpis, actions, type Kpi } from "@/lib/marketing/engine";
import { getSettings } from "@/lib/marketing/settings";
import { autoBlockCandidates } from "@/lib/marketing/automation";
import { buildWeeklyReport } from "@/lib/marketing/report";
import { adsApiConfigured } from "@/lib/google-ads-api";
export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/**
 * Admin → Today: the marketing engine's front page (lib/marketing/*). This
 * week against last, the ranked to-do list from every data source, the
 * automation switches with a preview of exactly what tonight's run would do,
 * and the weekly report as it would be emailed.
 */
export default async function TodayPage() {
  const admin = await requireAdmin();
  let data: any = null;
  try {
    const db = await getPrisma();
    const settings = await getSettings(db);
    const [k, a, tonight, report, lastRun] = await Promise.all([
      // Widest thresholds: the form narrows this list as he types, so the preview always matches the numbers on screen.
      kpis(db), actions(db), autoBlockCandidates(db, { ...settings, autoBlock: true, autoBlockMinSpend: 3, autoBlockMaxPerDay: 25 }), buildWeeklyReport(db),
      db.adminAuditLog.findFirst({ where: { action: "marketing:daily" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, newValue: true } }).catch(() => null),
    ]);
    data = { k, a, settings, tonight, report, lastRun };
  } catch (e) {
    console.error("admin today", e);
  }

  return (
    <AdminShell active="/admin/today" email={admin.email}>
      <PageTitle>Today</PageTitle>
      <p className="mt-1 max-w-[720px] text-sm text-muted">
        What to do next, worked out from Google Ads, Search Console, your website&apos;s calls and enquiries, your catalogue and
        your prices. Each item says which rule raised it. Nothing changes until you press its button — or switch on automation below.
      </p>
      {!data ? <Notice tone="danger" className="mt-5">The database isn&apos;t answering, so the engine can&apos;t run.</Notice> : (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-blue-deep">This week · {data.k.from} to {data.k.to}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {data.k.items.map((k: Kpi) => <KpiTile key={k.label} k={k} />)}
          </div>

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-deep">To do · {data.a.list.length}</h2>
          {data.a.notes.map((n: string) => <Notice key={n} tone="info" className="mt-3">{n}</Notice>)}
          <div className="mt-3"><ActionList initial={data.a.list} live={adsApiConfigured()} /></div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <EngineSettings initial={data.settings} cronReady={!!process.env.CRON_SECRET}
              tonight={data.tonight.map((t: any) => ({ label: t.label, cost: t.cost, clicks: t.clicks }))} />
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Last daily run</h2>
              {data.lastRun ? (
                <dl className="mt-3 space-y-1.5 text-[13px]">
                  <div><dt className="inline font-semibold">When: </dt><dd className="inline">{new Date(data.lastRun.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</dd></div>
                  <div><dt className="inline font-semibold">Google sync: </dt><dd className="inline">{typeof data.lastRun.newValue?.sync === "string" ? data.lastRun.newValue.sync : `${data.lastRun.newValue?.sync?.reports ?? 0} reports, ${data.lastRun.newValue?.sync?.days ?? 0} campaign-days`}</dd></div>
                  <div><dt className="inline font-semibold">Auto-block: </dt><dd className="inline">{data.lastRun.newValue?.autoBlock?.blocked?.length ? data.lastRun.newValue.autoBlock.blocked.map((b: string) => `“${b}”`).join(", ") : data.lastRun.newValue?.autoBlock?.note || "nothing to block"}</dd></div>
                  <div><dt className="inline font-semibold">Report: </dt><dd className="inline">{typeof data.lastRun.newValue?.report === "string" ? data.lastRun.newValue.report : data.lastRun.newValue?.report?.sent ? `sent via ${data.lastRun.newValue.report.via}` : data.lastRun.newValue?.report?.reason}</dd></div>
                </dl>
              ) : <p className="mt-3 text-[13px] text-muted">It hasn&apos;t run yet. It will run every morning at 7am once it&apos;s switched on (the <code className="font-mono">CRON_SECRET</code> setting in Vercel).</p>}
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-semibold text-blue-deep">Preview this week&apos;s report</summary>
                <p className="mt-2 text-[13px] font-semibold">{data.report.subject}</p>
                <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-paper-2/70 p-3 font-mono text-[11.5px] leading-relaxed">{data.report.text}</pre>
              </details>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
