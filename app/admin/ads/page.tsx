import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import AdminShell from "@/components/admin/AdminShell";
import CopyField from "@/components/admin/CopyField";
import { Card, StatTile, Badge, EmptyState } from "@/components/admin/ui";
import { Megaphone, PhoneCall, MapPin, CircleCheck, CircleAlert } from "lucide-react";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * The owner runs the shop's marketing through Google Ads. This page is his
 * ads cockpit, built from what the site itself knows first-party:
 *   1. FEED HEALTH — Shopping / Performance Max run off /merchant-feed.xml;
 *      every product that falls out of the feed is ad spend that can't work.
 *      Each exclusion is bucketed by the ONE reason that knocks it out first,
 *      so every count maps to a single fix.
 *   2. WHAT ADS PRODUCE — sessions that land with gclid/UTM get stamped
 *      (lib/ad-source) and every call click / postcode check carries the tag.
 */
async function adsData() {
  const db = await getPrisma();
  const [products, poaCats, events30] = await Promise.all([
    db.product.findMany({
      select: {
        title: true, brand: true, productCode: true, slug: true, category: true, subcategory: true,
        priceNow: true, mainImage: true, availabilityNormalised: true, isVisible: true,
      },
    }),
    db.category.findMany({ where: { priceOnApplication: true }, select: { name: true } }),
    db.trackedEvent.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      select: { type: true, productSlug: true, source: true, createdAt: true },
    }),
  ]);
  const poa = new Set(poaCats.map((c: { name: string }) => c.name));

  // One bucket per product — the first gate it fails is the one fix that matters.
  type Row = (typeof products)[number];
  const buckets: Record<string, Row[]> = { eligible: [], hidden: [], poa: [], noPrice: [], noImage: [], availability: [] };
  for (const p of products) {
    if (!p.isVisible) buckets.hidden.push(p);
    else if (poa.has(p.category) || poa.has(p.subcategory)) buckets.poa.push(p);
    else if (p.priceNow === null) buckets.noPrice.push(p);
    else if (!p.mainImage) buckets.noImage.push(p);
    else if (!["in_stock", "limited"].includes(p.availabilityNormalised)) buckets.availability.push(p);
    else buckets.eligible.push(p);
  }

  const fromAds = events30.filter((e: any) => e.source === "google-ads");
  const adCalls = fromAds.filter((e: any) => e.type === "call_click");
  const bySlug = new Map<string, number>();
  for (const c of adCalls) if (c.productSlug) bySlug.set(c.productSlug, (bySlug.get(c.productSlug) || 0) + 1);
  const topAdSlugs = [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topAdProducts = topAdSlugs
    .map(([slug, n]) => ({ n, p: products.find((x: Row) => x.slug === slug) }))
    .filter((x): x is { n: number; p: Row } => !!x.p);

  return {
    buckets,
    total: products.length,
    ads30: {
      calls: adCalls.length,
      postcodes: fromAds.filter((e: any) => e.type === "postcode_check").length,
      allCalls: events30.filter((e: any) => e.type === "call_click").length,
      topAdProducts,
    },
  };
}

const EXCLUSIONS: [key: string, label: string, fix: string][] = [
  ["availability", "Awaiting stock / call to confirm", "Set availability to In stock or Limited on the product"],
  ["noImage", "No photo", "Add a photo — image-less products can't run in Shopping"],
  ["noPrice", "No price", "Give it a price, or accept it stays out (Google requires one)"],
  ["poa", "Call-for-price category", "Correct by design — withheld prices must not reach Google"],
  ["hidden", "Hidden from the storefront", "Correct by design — hidden means hidden everywhere"],
];

export default async function AdminAds() {
  const admin = await requireAdmin();
  let d: Awaited<ReturnType<typeof adsData>> | null = null;
  try { d = await adsData(); } catch { /* DB down */ }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005").replace(/\/+$/, "");

  if (!d) {
    return (
      <AdminShell active="/admin/ads" email={admin.email}>
        <h1 className="font-display text-2xl font-semibold">Google Ads</h1>
        <p className="mt-4 text-sm text-muted">The database isn&apos;t running, so feed health can&apos;t load.</p>
      </AdminShell>
    );
  }

  const eligible = d.buckets.eligible.length;
  const pct = Math.round((eligible / Math.max(1, d.total)) * 100);

  return (
    <AdminShell active="/admin/ads" email={admin.email}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold">
            <Megaphone size={22} className="text-blue-deep" aria-hidden /> Google Ads
          </h1>
          <p className="mt-1 max-w-[640px] text-sm text-muted">
            Shopping and Performance Max campaigns sell from your product feed. This page keeps the feed
            healthy and shows what your ad spend actually produces — measured by this site, first-party.
          </p>
        </div>
      </div>

      {/* ---- feed health ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Feed health</h2>
            <span className="font-mono text-[11px] text-ink/45">{eligible.toLocaleString("en-GB")} of {d.total.toLocaleString("en-GB")} products advertisable</span>
          </div>

          {/* the one number that matters, then the reasons */}
          <div className="mt-4 flex items-center gap-4">
            <div className="font-display text-[44px] font-semibold leading-none text-navy">{pct}%</div>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-paper-2">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#1173d4,#0b4a8d)]" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <ul className="mt-5 divide-y divide-line text-sm">
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2 font-semibold text-ink"><CircleCheck size={15} className="text-success" aria-hidden /> In the feed</span>
              <strong className="tabular-nums">{eligible.toLocaleString("en-GB")}</strong>
            </li>
            {EXCLUSIONS.map(([key, label, fix]) => {
              const n = d!.buckets[key].length;
              const byDesign = key === "poa" || key === "hidden";
              return (
                <li key={key} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CircleAlert size={15} className={byDesign ? "text-muted" : n ? "text-warning" : "text-muted"} aria-hidden />
                      {label}
                    </span>
                    <span className="flex items-center gap-2.5">
                      {byDesign ? <Badge tone="neutral">by design</Badge> : n > 0 ? <Badge tone="warning">fixable</Badge> : <Badge tone="success">clear</Badge>}
                      <strong className="w-14 text-right tabular-nums">{n.toLocaleString("en-GB")}</strong>
                    </span>
                  </div>
                  {!byDesign && n > 0 && (
                    <p className="mt-1 pl-6 text-[12px] text-muted">
                      {fix} —{" "}
                      <Link href="/admin/products" className="font-semibold text-blue-deep hover:underline">open products</Link>
                      <span className="text-ink/40"> · e.g. {d!.buckets[key].slice(0, 3).map((p) => p.productCode).join(", ")}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Your product feed</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Paste this into <strong className="text-ink">Google Merchant Center → Products → Feeds → scheduled fetch</strong> (daily).
              Google re-reads it every day, so price edits here reach your ads without touching anything.
            </p>
            <div className="mt-3">
              <CopyField value={`${base}/merchant-feed.xml`} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Setup checklist</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ink/80">
              <li>Merchant Center: add the feed above as a scheduled fetch.</li>
              <li>Link Merchant Center to the Google Ads account (Settings → Linked accounts).</li>
              <li>Point Shopping / Performance Max at the linked feed.</li>
              <li>Keep auto-tagging ON (it&apos;s the default) — that&apos;s how this page attributes calls to ads.</li>
            </ol>
          </Card>
        </div>
      </div>

      {/* ---- what the spend produces ---- */}
      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-deep">What your ads produced · last 30 days</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <StatTile label="Calls from Google Ads" value={d.ads30.calls} hint={`of ${d.ads30.allCalls} calls site-wide`}>
          <PhoneCall size={15} className="mt-2 text-blue-deep" aria-hidden />
        </StatTile>
        <StatTile label="Postcode checks from ads" value={d.ads30.postcodes}>
          <MapPin size={15} className="mt-2 text-blue-deep" aria-hidden />
        </StatTile>
        <StatTile label="Ad share of calls" value={d.ads30.allCalls ? `${Math.round((d.ads30.calls / d.ads30.allCalls) * 100)}%` : "—"} />
      </div>

      <div className="mt-4">
        {d.ads30.topAdProducts.length ? (
          <Card className="p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Products your ads make the phone ring for</h3>
            <ul className="mt-3 divide-y divide-line">
              {d.ads30.topAdProducts.map(({ n, p }: any) => (
                <li key={p.slug} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.mainImage ? <img src={p.mainImage} alt="" className="h-full w-full object-contain p-0.5" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-tight">{p.brand} {p.title}</div>
                    <div className="font-mono text-[10.5px] text-ink/45">{p.productCode}</div>
                  </div>
                  <span className="rounded-full bg-blue/10 px-2.5 py-1 text-xs font-bold text-blue-deep">{n} {n === 1 ? "call" : "calls"}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title="No ad-attributed activity yet"
            hint="As soon as someone clicks a Google ad and lands here (auto-tagging adds gclid to the URL), their calls and postcode checks are counted above — no cookies, no third parties."
          />
        )}
      </div>
    </AdminShell>
  );
}
