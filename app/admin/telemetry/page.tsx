import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import AdminShell from "@/components/admin/AdminShell";
import { BarChart, HBar } from "@/components/admin/Charts";
import { Badge, Card, Notice, PageTitle } from "@/components/admin/ui";
import { telemetry } from "@/lib/marketing/telemetry";
export const metadata = { title: "Telemetry" };
export const dynamic = "force-dynamic";

/**
 * Admin → Telemetry (lib/marketing/telemetry.ts): from being seen on Google to
 * a sale, by channel, for 7 / 30 / 90 days.
 */
const n = (x: number) => Math.round(x).toLocaleString("en-GB");
const money = (x: number) => `£${x.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : "—");

export default async function TelemetryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const admin = await requireAdmin();
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  let t: Awaited<ReturnType<typeof telemetry>> | null = null, firstVisit: Date | null = null;
  try {
    const db = await getPrisma();
    [t, firstVisit] = await Promise.all([
      telemetry(db, days),
      db.trackedEvent.findFirst({ where: { type: "page_view" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }).then((r: any) => r?.createdAt ?? null).catch(() => null),
    ]);
  } catch (e) { console.error("telemetry", e); }

  // When visit counting began, to the minute and in UK time: calls earlier that
  // same day are in the charts but not the funnel, and "since 23 Sept" alone
  // read as a contradiction.
  const since = t?.partial ? new Date(t.siteSince).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
  const funnel = t ? [
    { label: "Seen on Google", value: t.ads.impressions + (t.organic?.impressions ?? 0), note: `${n(t.ads.impressions)} ads${t.organic ? ` + ${n(t.organic.impressions)} free results` : ""}` },
    { label: "Clicked through from Google", value: t.ads.clicks + (t.organic?.clicks ?? 0), note: `${n(t.ads.clicks)} ads (${money(t.ads.cost)})${t.organic ? ` + ${n(t.organic.clicks)} free` : ""}` },
    { label: "Visits to the website", value: t.total.visits, note: t.partial ? `every channel · since ${since}` : "every channel, not only Google" },
    { label: "Product pages viewed", value: t.total.productViews, note: t.total.visits ? `${(t.total.productViews / t.total.visits).toFixed(1)} per visit — page views, not people` : "page views, not people" },
    { label: "Called, checked a postcode or enquired", value: t.total.calls + t.total.postcodes + t.total.enquiries, note: `${n(t.total.calls)} call taps · ${n(t.total.postcodes)} postcode checks · ${n(t.total.enquiries)} enquiries${t.partial ? ` · since ${since}` : ""}` },
    { label: "Sales", value: t.total.sales, note: t.total.sales ? `${money(t.total.salesValue)} — enquiries marked Won` : "mark enquiries Won in Sales & Leads" },
  ] : [];
  const top = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <AdminShell active="/admin/telemetry" email={admin.email}>
      <PageTitle actions={<div className="flex gap-1.5">{[7, 30, 90].map((d) => (
        <Link key={d} href={`?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${d === days ? "bg-navy text-paper" : "border border-navy/20 hover:border-blue"}`}>{d} days</Link>
      ))}</div>}>Telemetry</PageTitle>
      {!t ? <Notice tone="danger" className="mt-5">The database isn&apos;t answering.</Notice> : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />{t.liveNow} page views in the last 30 minutes</span>
            {firstVisit && <span>· visit counting started {new Date(firstVisit).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}</span>}
            {!t.organic && <span>· free Google results appear once Search Console answers</span>}
          </div>

          {t.partial && (
            <Notice tone="info" className="mt-4">
              The funnel&apos;s website numbers (visits onwards) count from {since}, when visit counting began, so they compare
              like with like. Google&apos;s numbers and the charts below cover the full {days} days. They line up once {days} days have passed.
            </Notice>
          )}

          {/* ---- the funnel ---- */}
          <Card className="mt-5 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">From Google to a sale · last {days} days</h2>
            <ol className="mt-4 space-y-2.5">
              {funnel.map((f, i) => (
                <li key={f.label} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-4 sm:grid-cols-[260px_minmax(0,1fr)_110px]">
                  <div className="text-[13.5px]"><span className="font-semibold">{f.label}</span><span className="block text-[11.5px] text-muted">{f.note}</span></div>
                  <div className="hidden h-7 overflow-hidden rounded bg-paper-2 sm:block">
                    <div className="h-full rounded bg-[linear-gradient(90deg,#1173d4,#0a2788)]" style={{ width: `${Math.max(1.5, Math.sqrt(f.value / top) * 100)}%` }} />
                  </div>
                  <div className="text-right">
                    <span className="font-display text-xl tabular-nums">{n(f.value)}</span>
                    {i > 0 && !(t!.partial && i === 2) && f.value <= funnel[i - 1].value && <span className="block text-[11px] text-muted">{pct(f.value, funnel[i - 1].value)} of the step above</span>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11.5px] text-muted">Bar lengths use a square-root scale so the small steps stay visible.</p>
          </Card>

          {/* ---- channels ---- */}
          <Card className="mt-5 overflow-x-auto p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Where customers come from</h2>
            <table className="mt-3 w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted"><tr>
                <th className="py-2">Channel</th><th className="py-2 text-right">Visits</th><th className="py-2 text-right">Product views</th>
                <th className="py-2 text-right">Call taps</th><th className="py-2 text-right">Postcode checks</th><th className="py-2 text-right">Enquiries</th>
                <th className="py-2 text-right">Sales</th><th className="py-2 text-right">Visit → contact</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {t.byChannel.map((r) => (
                  <tr key={r.channel}>
                    <td className="py-2 font-medium">{r.channel}{r.channel === "AI assistants" && r.visits > 0 && <span className="ml-2"><Badge tone="success">AI visits</Badge></span>}</td>
                    <td className="py-2 text-right tabular-nums">{n(r.visits)}</td>
                    <td className="py-2 text-right tabular-nums">{n(r.productViews)}</td>
                    <td className="py-2 text-right tabular-nums">{n(r.calls)}</td>
                    <td className="py-2 text-right tabular-nums">{n(r.postcodes)}</td>
                    <td className="py-2 text-right tabular-nums">{n(r.enquiries)}</td>
                    <td className="py-2 text-right tabular-nums">{r.sales ? `${r.sales} · ${money(r.salesValue)}` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{pct(r.calls + r.postcodes + r.enquiries, r.visits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {t.ads.clicks > 0 && <p className="mt-3 text-[12.5px] text-muted">
              Google Ads: {money(t.ads.cost)} for {n(t.ads.clicks)} clicks ({money(t.ads.cost / t.ads.clicks)} a click) and {n(t.ads.conversions)} calls &amp; enquiries
              ({t.ads.conversions ? money(t.ads.cost / t.ads.conversions) : "—"} each).
            </p>}
          </Card>

          {/* ---- over time ---- */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Visits per day</h2>
              <div className="mt-4"><BarChart label="Visits per day" data={t.series.map((s) => ({ label: `${s.date.slice(8)}/${s.date.slice(5, 7)}`, value: s.visits }))} /></div>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Call taps per day</h2>
              <div className="mt-4"><BarChart label="Call taps per day" data={t.series.map((s) => ({ label: `${s.date.slice(8)}/${s.date.slice(5, 7)}`, value: s.calls }))} /></div>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {/* ---- products ---- */}
            <Card className="p-5 lg:col-span-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Products people look at — and phone about</h2>
              {t.products.length ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-2">Product</th><th className="py-2 text-right">Views</th><th className="py-2 text-right">Call taps</th><th className="py-2 text-right">Sales</th><th className="py-2 w-[26%]" /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {t.products.map((p) => (
                      <tr key={p.slug}>
                        <td className="py-2"><a href={`/products/${p.slug}`} target="_blank" rel="noreferrer" className="hover:text-blue-deep">{p.slug}</a></td>
                        <td className="py-2 text-right tabular-nums">{p.views}</td>
                        <td className="py-2 text-right tabular-nums">{p.calls}</td>
                        <td className="py-2 text-right tabular-nums">{p.sales || "—"}</td>
                        <td className="py-2 pl-3"><HBar value={p.views} max={t!.products[0].views} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="mt-3 text-sm text-muted">Fills in as visitors browse.</p>}
            </Card>

            {/* ---- AI + landing ---- */}
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Sent by AI assistants</h2>
              {t.aiHosts.length ? <ul className="mt-3 space-y-1.5 text-sm">{t.aiHosts.map(([h, c]) => <li key={h} className="flex justify-between"><span>{h}</span><span className="tabular-nums">{c}</span></li>)}</ul>
                : <p className="mt-3 text-[13px] text-muted">None yet. ChatGPT, Perplexity, Gemini and Copilot visits will show here — the town pages are what earn them.</p>}
              <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-blue-deep">Where visits land</h2>
              {t.landings.length ? <ul className="mt-3 space-y-1.5 text-sm">{t.landings.map(([p, c]) => <li key={p} className="flex justify-between gap-3"><span className="truncate">{p}</span><span className="tabular-nums">{c}</span></li>)}</ul>
                : <p className="mt-3 text-[13px] text-muted">Fills in as visitors arrive.</p>}
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* ---- towns ---- */}
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Towns showing interest</h2>
              {t.towns.length ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-2">Town</th><th className="py-2 text-right">Town-page visits</th><th className="py-2 text-right">Postcode checks</th></tr></thead>
                  <tbody className="divide-y divide-line">{t.towns.map((x) => (
                    <tr key={x.name}><td className="py-2">{x.name}</td><td className="py-2 text-right tabular-nums">{x.pageVisits}</td><td className="py-2 text-right tabular-nums">{x.postcodeChecks}</td></tr>
                  ))}</tbody>
                </table>
              ) : <p className="mt-3 text-sm text-muted">Fills in from town-page visits and postcode checks.</p>}
            </Card>

            {/* ---- hours ---- */}
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">When people visit (UK time)</h2>
              <div className="mt-4 grid grid-cols-12 gap-1">
                {t.hours.map((v, h) => {
                  const max = Math.max(1, ...t!.hours);
                  return (
                    <div key={h} className="text-center">
                      <div className="h-10 rounded" title={`${h}:00 — ${v} visits`} style={{ background: `rgba(10,39,136,${0.08 + (v / max) * 0.85})` }} />
                      <span className="text-[10px] text-muted">{String(h).padStart(2, "0")}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-muted">Darker = more visits. Useful for when to answer the phone — and when ads should run hardest.</p>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
