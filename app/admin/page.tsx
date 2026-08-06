import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import { Sparkline, BarChart, HBar } from "@/components/admin/Charts";
import { Card, StatTile } from "@/components/admin/ui";
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
const delta = (series: number[]) => {
  const half = Math.floor(series.length / 2);
  const prev = series.slice(0, half).reduce((a, b) => a + b, 0);
  const cur = series.slice(half).reduce((a, b) => a + b, 0);
  if (!prev) return cur ? "new" : "—";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs prev week`;
};

async function dashboard() {
  const db = await getPrisma();
  const since14 = new Date(Date.now() - 14 * DAY);
  const poaNames = (await db.category.findMany({ where: { priceOnApplication: true }, select: { name: true } })).map((c: { name: string }) => c.name);
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
        ...(poaNames.length && { NOT: [{ category: { in: poaNames } }, { subcategory: { in: poaNames } }] }),
      },
    }),
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

  return {
    d14, callSeries, pcSeries, enqSeries, newEnquiries, latestEnquiries, topCalled, topAreas, localShare,
    totals: { calls14: calls.length, pcs14: pcs.length, enq14: enquiries14.length },
    counts: { products: counts[0], categories: counts[1], brands: counts[2] },
    missingPrices: missing.filter((p: any) => p.priceNow === null).length,
    missingImages: missing.filter((p: any) => !p.mainImage).length,
    lastScrape: lastJob?.finishedAt || lastJob?.startedAt || null,
    audit,
    feedReady,
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

  const week = (s: number[]) => s.slice(7).reduce((a, b) => a + b, 0);
  const statCards = [
    { label: "Call clicks · 7 days", value: week(d.callSeries), series: d.callSeries, note: delta(d.callSeries) },
    { label: "Postcode checks · 7 days", value: week(d.pcSeries), series: d.pcSeries, note: delta(d.pcSeries) },
    { label: "Enquiries · 7 days", value: week(d.enqSeries), series: d.enqSeries, note: delta(d.enqSeries) },
  ];
  const statusColor: Record<string, string> = { new: "bg-blue text-white", contacted: "bg-amber-100 text-amber-800", closed: "bg-paper-2 text-muted" };

  return (
    <AdminShell active="/admin" email={admin.email}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Live from the shop's own first-party analytics — no cookies, nothing sent to third parties.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-ink/40 lg:block">
            Last catalogue import: {d.lastScrape ? new Date(d.lastScrape).toLocaleString("en-GB") : "—"}
          </span>
          <Link href="/admin/products/new"
            className="rounded-full bg-navy px-5 py-2.5 text-[13px] font-bold text-paper transition-colors hover:bg-navy-2">
            + Add product
          </Link>
        </div>
      </div>

      {/* ---- stat cards with sparklines ---- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((c) => (
          <StatTile key={c.label} label={c.label} value={c.value} hint={c.note}>
            <div className="mt-2"><Sparkline points={c.series} /></div>
          </StatTile>
        ))}
        <StatTile label="Enquiries awaiting a reply" value={d.newEnquiries}>
          <Link href="/admin/enquiries" className="mt-3 inline-block rounded-full bg-navy px-4 py-1.5 text-xs font-bold text-paper hover:bg-navy-2">
            Open inbox →
          </Link>
        </StatTile>
      </div>

      {/* ---- calls per day + most-called products ---- */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Call clicks per day</h2>
            <span className="text-xs text-ink/45">last 14 days · {d.totals.calls14} total</span>
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
                    <div className="text-xs text-ink/45">{p.priceNow === null ? "Call for price" : `£${p.priceNow}`}</div>
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
            <span className="text-xs text-ink/45">
              {d.totals.pcs14} postcode checks{d.localShare !== null ? ` · ${d.localShare}% local` : ""}
            </span>
          </div>
          {d.topAreas.length ? (
            <ul className="mt-3 space-y-2.5">
              {d.topAreas.map(([area, n]) => (
                <li key={area} className="grid grid-cols-[64px_1fr_40px] items-center gap-3">
                  <span className="font-mono text-[13px] font-bold text-navy">{area}</span>
                  <HBar value={n} max={d!.topAreas[0][1]} />
                  <span className="text-right text-xs text-ink/50">{n}</span>
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
            <Link href="/admin/enquiries" className="text-xs font-semibold text-blue hover:underline">View all →</Link>
          </div>
          {d.latestEnquiries.length ? (
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.latestEnquiries.map((e: any, i: number) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="font-medium">{e.name}</span>
                    {e.productCode && <span className="ml-2 font-mono text-[11px] text-ink/45">{e.productCode}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor[e.status] || "bg-paper-2"}`}>{e.status}</span>
                    <span className="font-mono text-[10.5px] text-ink/40">
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
              <Link href="/admin/ads" className="font-bold text-blue-deep hover:underline">{d.feedReady.toLocaleString("en-GB")} →</Link>
            </li>
            <li className="flex justify-between"><span className="text-muted">Categories</span><strong>{d.counts.categories}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Brands</span><strong>{d.counts.brands}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Missing prices</span><strong className={d.missingPrices ? "text-amber-700" : ""}>{d.missingPrices}</strong></li>
            <li className="flex justify-between"><span className="text-muted">Missing images</span><strong className={d.missingImages ? "text-amber-700" : ""}>{d.missingImages}</strong></li>
          </ul>
          <Link href="/admin/products" className="mt-4 inline-block rounded-full border border-line px-4 py-1.5 text-xs font-semibold hover:border-blue hover:text-blue-deep">
            Manage products →
          </Link>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Recent changes</h2>
          {d.audit.length ? (
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.audit.map((a: any, i: number) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <strong className="font-semibold">{a.action}</strong>{" "}
                    <span className="text-muted">{a.entityType}{a.entityId.startsWith("bulk") ? ` (${a.entityId.split(":")[1]} items)` : ""}</span>{" "}
                    <span className="text-ink/40">— {Array.isArray(a.changedFields) ? (a.changedFields as string[]).join(", ") : ""}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-ink/40">
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
