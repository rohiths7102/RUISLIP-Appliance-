import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { poaNamesFromDb } from "@/lib/poa";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import { Sparkline, BarChart, HBar } from "@/components/admin/Charts";
import { Badge, Card, KpiTile, StatTile } from "@/components/admin/ui";
import { adminHref } from "@/lib/admin-config";
import { STAGE_LABEL, STAGE_TONE, stageOf } from "@/lib/leads";
import TargetsCard from "@/components/admin/TargetsCard";
import { kpis, actions, type Kpi } from "@/lib/marketing/engine";
import { health } from "@/lib/marketing/health";
import { getSettings } from "@/lib/marketing/settings";
// Same route segment as the admin layout, so its "%s · Back office" template doesn't reach this page.
export const metadata = { title: { absolute: "Dashboard · Back office" } };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** last `n` days as [{key,label}] oldest→newest */
function days(n: number) {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    out.push({ key: dayKey(d), label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).replace(" ", " ") });
  }
  return out;
}
const bucket = (rows: { createdAt: Date }[], keys: string[]) => {
  const m = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = dayKey(new Date(r.createdAt));
    if (m.has(k)) m.set(k, (m.get(k) || 0) + 1);
  }
  return keys.map((k) => m.get(k) || 0);
};
async function dashboard() {
  const db = await getPrisma();
  const since14 = new Date(Date.now() - 14 * DAY);
  const poaNames = [...(await poaNamesFromDb(db))];
  const [events, enquiries14, newEnquiries, latestEnquiries, counts, missing, lastJob, audit, feedReady] = await Promise.all([
    db.trackedEvent.findMany({ where: { createdAt: { gte: since14 } }, select: { type: true, productSlug: true, postcode: true, isLocal: true, createdAt: true } }),
    db.enquiry.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true } }),
    db.enquiry.count({ where: { status: "new" } }),
    db.enquiry.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { name: true, productCode: true, status: true, createdAt: true, source: true } }),
    Promise.all([db.product.count(), db.category.count(), db.brand.count()]),
    db.product.findMany({ select: { priceNow: true, mainImage: true } }),
    db.scrapeJob.findFirst({ orderBy: { startedAt: "desc" } }),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { action: true, entityType: true, entityId: true, changedFields: true, changedBy: true, createdAt: true } }),
    // Mirrors the merchant feed's own gate — the number the Ads page explains.
    db.product.count({
      where: {
        isVisible: true, priceNow: { not: null }, mainImage: { not: "" },
        availabilityNormalised: { in: ["in_stock", "limited"] },
        ...(poaNames.length && { NOT: [{ category: { in: poaNames } }, { subcategory: { in: poaNames } }, { brand: { in: poaNames } }] }),
      },
    }),
  ]);

  // Sales pipeline snapshot: open leads and what's on the table in quotes.
  const [openLeads, quotedAgg] = await Promise.all([
    db.enquiry.count({ where: { status: { in: ["new", "contacted", "quoted"] } } }),
    db.enquiry.aggregate({ _sum: { quotedPrice: true }, where: { status: { in: ["contacted", "quoted"] } } }),
  ]);

  const d14 = days(14);
  const keys = d14.map((d) => d.key);
  const calls = events.filter((e: any) => e.type === "call_click");
  const pcs = events.filter((e: any) => e.type === "postcode_check");
  const callSeries = bucket(calls, keys);
  const pcSeries = bucket(pcs, keys);
  const enqSeries = bucket(enquiries14, keys);

  // most called-about products
  const bySlug = new Map<string, number>();
  for (const c of calls as any[]) if (c.productSlug) bySlug.set(c.productSlug, (bySlug.get(c.productSlug) || 0) + 1);
  const topSlugs = [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const prods = topSlugs.length
    ? await db.product.findMany({ where: { slug: { in: topSlugs.map(([s]) => s) } }, select: { slug: true, title: true, brand: true, mainImage: true, priceNow: true } })
    : [];
  const topCalled = topSlugs.map(([slug, n]) => ({ n, p: prods.find((x: any) => x.slug === slug) })).filter((x) => x.p);

  // where the demand is — outward codes
  const byArea = new Map<string, number>();
  for (const p of pcs as any[]) {
    const area = (p.postcode.match(/^[A-Z]{1,2}\d{0,2}/) || [p.postcode.slice(0, 4)])[0];
    if (area) byArea.set(area, (byArea.get(area) || 0) + 1);
  }
  const topAreas = [...byArea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const localShare = pcs.length ? Math.round((pcs.filter((p: any) => p.isLocal).length / pcs.length) * 100) : null;

  // The engine's view: this week against last, is everything in sync, what to do.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthIso = monthStart.toISOString().slice(0, 10);
  const [k, sync, todo, settings, monthAds, monthEnq, monthSales] = await Promise.all([
    kpis(db), health(db), actions(db), getSettings(db),
    db.adsCampaignDay.aggregate({ _sum: { cost: true, conversions: true }, where: { date: { gte: monthIso } } }).catch(() => ({ _sum: {} })),
    db.enquiry.count({ where: { createdAt: { gte: monthStart } } }).catch(() => 0),
    db.enquiry.count({ where: { createdAt: { gte: monthStart }, status: { in: ["won", "closed"] } } }).catch(() => 0),
  ]);
  const month = {
    label: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    // How far through the month we are, so a bar at 30% on the 9th reads as on track.
    pace: Math.round((now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) * 100),
    adCalls: monthAds._sum.conversions || 0, adSpend: monthAds._sum.cost || 0, enquiries: monthEnq, sales: monthSales,
  };

  return {
    k, sync, todo: todo.list.slice(0, 4), todoCount: todo.list.length, targets: settings.targets, month,
    d14, callSeries, pcSeries, enqSeries, newEnquiries, latestEnquiries, topCalled, topAreas, localShare,
    totals: { calls14: calls.length, pcs14: pcs.length, enq14: enquiries14.length },
    counts: { products: counts[0], categories: counts[1], brands: counts[2] },
    missingPrices: missing.filter((p: any) => p.priceNow === null).length,
    missingImages: missing.filter((p: any) => !p.mainImage).length,
    lastScrape: lastJob?.finishedAt || lastJob?.startedAt || null,
    audit,
    feedReady,
    openLeads,
    quotedValue: quotedAgg._sum.quotedPrice || 0,
  };
}

export default async function AdminOverview() {
  const admin = await requireAdmin();
  let d: Awaited<ReturnType<typeof dashboard>> | null = null;
  try { d = await dashboard(); } catch { /* DB down — render the notice below */ }

  if (!d) {
    return (
      <AdminShell active="/admin" email={admin.email}>
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&apos;t running, so live stats can&apos;t load. Run{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">npx prisma migrate dev</code> and restart.
        </div>
      </AdminShell>
    );
  }

  // Same 7-day numbers as Today and the Monday email (lib/marketing/engine.ts kpis).
  const kv = (label: string) => d!.k.items.find((x) => x.label === label)!;
  const statCards = [
    { k: kv("Call taps on the website"), label: "Call taps · 7 days", series: d.callSeries },
    { k: kv("Postcode checks"), label: "Postcode checks · 7 days", series: d.pcSeries },
    { k: kv("Enquiries"), label: "Enquiries · 7 days", series: d.enqSeries },
  ];

  return (
    <AdminShell active="/admin" email={admin.email}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            What needs doing, how the month is going, and what the website brought in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-ink/70 lg:block">
            Last catalogue import: {d.lastScrape ? new Date(d.lastScrape).toLocaleString("en-GB") : "—"}
          </span>
          <Link href={adminHref("products/new")}
            className="rounded-full bg-navy px-5 py-2.5 text-[13px] font-bold text-paper transition-colors hover:bg-navy-2">
            + Add product
          </Link>
        </div>
      </div>

      {/* ---- what to do next, and is everything in sync ---- */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">To do next</h2>
            <Link href={adminHref("today")} className="text-xs font-semibold text-blue hover:underline">All {d.todoCount} on Today →</Link>
          </div>
          {d.todo.length ? (
            <ol className="mt-3 divide-y divide-line text-sm">
              {d.todo.map((a, i) => (
                <li key={a.key} className="flex gap-3 py-2.5">
                  <span className="w-5 shrink-0 font-mono text-xs text-muted">{i + 1}</span>
                  <div className="min-w-0">
                    <Link href={a.cta.kind === "link" && !a.cta.external ? a.cta.href : adminHref("today")} className="font-medium hover:text-blue-deep">{a.title}</Link>
                    <span className="block text-[12.5px] text-muted">{a.why}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 text-sm text-muted">Nothing outstanding — everything the engine checks is in order.</p>}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">In sync?</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.sync.map((h) => (
              <li key={h.name} className="flex items-start gap-3 py-2.5">
                <span role="img" aria-label={h.status === "ok" ? "working" : h.status === "warn" ? "needs a look" : "not set up"}
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${h.status === "ok" ? "bg-success" : h.status === "warn" ? "bg-warning" : "bg-muted"}`} />
                <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={h.href} className="font-semibold hover:text-blue-deep">{h.name}</Link>
                    {h.status !== "ok" && <Badge tone={h.status === "warn" ? "warning" : "neutral"}>{h.status === "warn" ? "check" : "not set up"}</Badge>}
                  </span>
                  <div className="text-[12.5px] text-muted">{h.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ---- stat cards with sparklines ---- */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((c) => (
          <StatTile key={c.label} label={c.label} value={Math.round(c.k.now)} hint={`${Math.round(c.k.before)} the week before`}>
            <div className="mt-2"><Sparkline points={c.series} /></div>
          </StatTile>
        ))}
        <StatTile
          label={`Open pipeline · ${d.newEnquiries} awaiting first reply`}
          value={d.openLeads}
          hint={d.quotedValue ? `£${d.quotedValue.toLocaleString("en-GB")} out in quotes` : undefined}
        >
          <Link href={adminHref("enquiries")} className="mt-3 inline-block rounded-full bg-navy px-4 py-1.5 text-xs font-bold text-paper hover:bg-navy-2">
            Open Sales &amp; Leads →
          </Link>
        </StatTile>
      </div>

      {/* ---- Google Ads this week, and the month against its targets ---- */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Google Ads · this week</h2>
            <Link href={adminHref("ads")} className="text-xs font-semibold text-blue hover:underline">Open Google Ads →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {d.k.items.slice(0, 3).map((x: Kpi) => <KpiTile key={x.label} k={x} inset />)}
          </div>
        </Card>
        <TargetsCard month={d.month} targets={d.targets} />
      </div>

      {/* ---- calls per day + most-called products ---- */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Call taps per day</h2>
            <span className="text-xs text-ink/70">last 14 days · {d.totals.calls14} total · <Link href={adminHref("telemetry")} className="font-semibold text-blue hover:underline">More on Telemetry →</Link></span>
          </div>
          <BarChart data={d.d14.map((day, i) => ({ label: day.label.split(" ")[0], value: d!.callSeries[i] }))} />
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Most called-about products</h2>
          {d.topCalled.length ? (
            <ul className="mt-3 divide-y divide-line">
              {d.topCalled.map(({ n, p }: any) => (
                <li key={p.slug} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.mainImage ? <img src={p.mainImage} alt="" className="h-full w-full object-contain p-0.5" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-tight">{p.brand} {p.title}</div>
                    <div className="text-xs text-ink/70">{p.priceNow === null ? "Call for price" : `£${p.priceNow}`}</div>
                  </div>
                  <span className="rounded-full bg-blue/10 px-2.5 py-1 text-xs font-bold text-blue-deep">{n} {n === 1 ? "call" : "calls"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              As soon as visitors press &quot;Call&quot; on a product, the products driving calls appear here.
            </p>
          )}
        </Card>
      </div>

      {/* ---- postcode demand + latest enquiries ---- */}
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Where customers are</h2>
            <span className="text-xs text-ink/70">
              {d.totals.pcs14} postcode checks in 14 days{d.localShare !== null ? ` · ${d.localShare}% local` : ""}
            </span>
          </div>
          {d.topAreas.length ? (
            <ul className="mt-3 space-y-2.5">
              {d.topAreas.map(([area, n]) => (
                <li key={area} className="grid grid-cols-[64px_1fr_40px] items-center gap-3">
                  <span className="font-mono text-[13px] font-bold text-navy">{area}</span>
                  <HBar value={n} max={d!.topAreas[0][1]} />
                  <span className="text-right text-xs text-ink/70">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Postcodes entered in the &quot;Do we deliver to you?&quot; prompt land here — your demand map.</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Latest enquiries</h2>
            <Link href={adminHref("enquiries")} className="text-xs font-semibold text-blue hover:underline">View all →</Link>
          </div>
          {d.latestEnquiries.length ? (
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.latestEnquiries.map((e: any, i: number) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="font-medium">{e.name}</span>
                    {e.productCode && <span className="ml-2 font-mono text-[11px] text-ink/70">{e.productCode}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STAGE_TONE[stageOf(e.status)] ?? "neutral"}>{STAGE_LABEL[stageOf(e.status)] ?? e.status}</Badge>
                    <span className="font-mono text-[10.5px] text-ink/70">
                      {new Date(e.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Contact-form and product enquiries appear here.</p>
          )}
        </Card>
      </div>

      {/* ---- catalogue health + audit trail ---- */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Catalogue</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between"><span className="text-muted">Products live</span><strong>{d.counts.products.toLocaleString("en-GB")}</strong></li>
            <li className="flex justify-between">
              <span className="text-muted">Ready for Google Ads</span>
              <Link href={adminHref("ads")} className="font-bold text-blue-deep hover:underline">{d.feedReady.toLocaleString("en-GB")} →</Link>
            </li>
            <li className="flex justify-between"><span className="text-muted">Categories</span><strong>{d.counts.categories}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Brands</span><strong>{d.counts.brands}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Missing prices</span><strong className={d.missingPrices ? "text-amber-700" : ""}>{d.missingPrices}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Missing images</span><strong className={d.missingImages ? "text-amber-700" : ""}>{d.missingImages}</strong></li>
          </ul>
          <Link href={adminHref("products")} className="mt-4 inline-block rounded-full border border-line px-4 py-1.5 text-xs font-semibold hover:border-blue hover:text-blue-deep">
            Manage products →
          </Link>
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Recent changes</h2>
            <Link href={adminHref("activity")} className="text-xs font-semibold text-blue hover:underline">Full activity log →</Link>
          </div>
          {d.audit.length ? (
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.audit.map((a: any, i: number) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <strong className="font-semibold">{a.action}</strong>{" "}
                    <span className="text-muted">{a.entityType}{a.entityId.startsWith("bulk") ? ` (${a.entityId.split(":")[1]} items)` : ""}</span>{" "}
                    <span className="text-ink/70">— {Array.isArray(a.changedFields) ? (a.changedFields as string[]).join(", ") : ""}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-ink/70">
                    {a.changedBy} · {new Date(a.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Changes you make are logged here with who and when.</p>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
