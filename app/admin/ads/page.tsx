import Link from "next/link";
import { adminHref } from "@/lib/admin-config";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { poaNamesFromDb } from "@/lib/poa";
import AdminShell from "@/components/admin/AdminShell";
import CopyField from "@/components/admin/CopyField";
import { adsSyncScript } from "@/lib/ads-sync-script";
import AdsReports, { SyncNowButton } from "@/components/admin/AdsReports";
import { inDeliveryZone } from "@/lib/ads-reports";
import { oauthConfigured, redirectUri } from "@/lib/google-oauth";
import { adsApiConfigured } from "@/lib/google-ads-api";
import { Card, StatTile, Badge, EmptyState } from "@/components/admin/ui";
import { Megaphone, PhoneCall, MapPin, CircleCheck, CircleAlert } from "lucide-react";
export const metadata = { title: "Google Ads" };
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
 *   3. THE ADS ACCOUNT ITSELF — spend, clicks and conversions per campaign,
 *      plus every report in lib/ads-reports.ts (search terms, keywords, ads,
 *      postcodes, times, devices, conversion types). Fed nightly by a Google
 *      Ads Script (lib/ads-sync-script.ts → /api/ads-sync), or live by the
 *      direct API (lib/google-ads-api.ts) once connected.
 */
async function adsData() {
  const db = await getPrisma();
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const [products, poa, events30, adsDays, snapshots, google] = await Promise.all([
    db.product.findMany({
      select: {
        title: true, brand: true, productCode: true, slug: true, category: true, subcategory: true,
        priceNow: true, mainImage: true, availabilityNormalised: true, isVisible: true,
      },
    }),
    poaNamesFromDb(db),
    db.trackedEvent.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      select: { type: true, productSlug: true, source: true, createdAt: true },
    }),
    db.adsCampaignDay.findMany({ where: { date: { gte: since } } }).catch(() => []),
    db.adsSnapshot.findMany().catch(() => []),
    db.googleConnection.findUnique({ where: { id: "google" }, select: { email: true, updatedAt: true } }).catch(() => null),
  ]);

  // One bucket per product — the first gate it fails is the one fix that matters.
  type Row = (typeof products)[number];
  const buckets: Record<string, Row[]> = { eligible: [], hidden: [], poa: [], noPrice: [], noImage: [], availability: [] };
  for (const p of products) {
    if (!p.isVisible) buckets.hidden.push(p);
    else if (poa.has(p.category) || poa.has(p.subcategory) || poa.has(p.brand)) buckets.poa.push(p);
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

  // Per campaign, busiest spend first; days with no activity are dropped.
  const camps = new Map<string, { name: string; status: string; clicks: number; cost: number; conversions: number }>();
  for (const r of adsDays) {
    const c = camps.get(r.campaignId) || { name: r.campaignName, status: r.status, clicks: 0, cost: 0, conversions: 0 };
    c.clicks += r.clicks; c.cost += r.cost; c.conversions += r.conversions;
    camps.set(r.campaignId, c);
  }
  const account = {
    campaigns: [...camps.values()].filter((c) => c.clicks || c.cost).sort((a, b) => b.cost - a.cost),
    lastSync: adsDays.reduce((m: Date | null, r: any) => (!m || r.syncedAt > m ? r.syncedAt : m), null) as Date | null,
  };

  const reports: Record<string, any[]> = Object.fromEntries(snapshots.map((s: any) => [s.report, s.rows]));
  const zone = Object.fromEntries((reports.postcodes || []).map((r: any) => [r.label, inDeliveryZone(r.label)]));

  return {
    account,
    reports,
    zone,
    google,
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

export default async function AdminAds({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const googleStatus = (await searchParams).google;
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

      {/* ---- the Ads account, synced nightly or live ---- */}
      <ConnectionCard google={d.google} status={googleStatus} />
      <AccountCard account={d.account} endpoint={`${base}/api/ads-sync`} />
      <AdsReports reports={d.reports} zone={d.zone} live={adsApiConfigured() && !!d.google} />

      {/* ---- feed health ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Feed health</h2>
            <span className="font-mono text-[11px] text-ink/70">{eligible.toLocaleString("en-GB")} of {d.total.toLocaleString("en-GB")} products advertisable</span>
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
                      <Link href={adminHref("products")} className="font-semibold text-blue-deep hover:underline">open products</Link>
                      <span className="text-ink/70"> · e.g. {d!.buckets[key].slice(0, 3).map((p, i) => (
                        <span key={p.productCode}>{i > 0 && ", "}<Link href={`${adminHref("products")}?q=${encodeURIComponent(p.productCode)}`} className="hover:text-blue-deep hover:underline">{p.productCode}</Link></span>
                      ))}</span>
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
                    <div className="font-mono text-[10.5px] text-ink/70">{p.productCode}</div>
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

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function AccountCard({ account, endpoint }: { account: Awaited<ReturnType<typeof adsData>>["account"]; endpoint: string }) {
  const secret = process.env.ADS_SYNC_SECRET || "";
  const t = account.campaigns.reduce((a, c) => ({ clicks: a.clicks + c.clicks, cost: a.cost + c.cost, conv: a.conv + c.conversions }), { clicks: 0, cost: 0, conv: 0 });
  const stale = !account.lastSync || Date.now() - account.lastSync.getTime() > 2 * DAY;
  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Google Ads account 609-936-8375 · last 30 days</h2>
        {account.lastSync
          ? <Badge tone={stale ? "warning" : "success"}>synced {account.lastSync.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge>
          : <Badge tone="warning">not connected yet</Badge>}
      </div>

      {account.campaigns.length > 0 && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <StatTile label="Spent" value={gbp(t.cost)} />
            <StatTile label="Clicks" value={t.clicks.toLocaleString("en-GB")} />
            <StatTile label="Calls & enquiries (conversions)" value={Math.round(t.conv)} />
            <StatTile label="Cost per conversion" value={t.conv ? gbp(t.cost / t.conv) : "—"} />
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2">Campaign</th><th className="py-2 text-right">Clicks</th><th className="py-2 text-right">Spent</th><th className="py-2 text-right">Conversions</th><th className="py-2 text-right">Per conversion</th></tr></thead>
            <tbody className="divide-y divide-line">
              {account.campaigns.map((c) => (
                <tr key={c.name}>
                  <td className="py-2">{c.name} {c.status !== "ENABLED" && <Badge tone="neutral">{c.status.toLowerCase()}</Badge>}</td>
                  <td className="py-2 text-right tabular-nums">{c.clicks}</td>
                  <td className="py-2 text-right tabular-nums">{gbp(c.cost)}</td>
                  <td className="py-2 text-right tabular-nums">{Math.round(c.conversions * 10) / 10}</td>
                  <td className="py-2 text-right tabular-nums">{c.conversions ? gbp(c.cost / c.conversions) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(stale || !account.campaigns.length) && (
        <div className="mt-4 text-[13px] leading-relaxed text-ink/80">
          {secret.length >= 24 ? (
            <>
              <p>
                {account.lastSync ? "The nightly sync has stopped. Check the script in Google Ads, or paste it again:" : "Connect the account once, and these numbers update every night:"}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>In Google Ads open <strong>Tools → Bulk actions → Scripts</strong> and press <strong>+</strong> → New script.</li>
                <li>Delete what&apos;s there, paste the script below (Copy copies all of it), and press <strong>Authorise</strong>.</li>
                <li>Press <strong>Run</strong> once, then set <strong>Frequency: Daily</strong> and save.</li>
              </ol>
              <div className="mt-3"><CopyField value={adsSyncScript(endpoint, secret)} label="Google Ads Script (contains this site's sync key; keep it private)" /></div>
            </>
          ) : (
            <p>Set <code className="font-mono">ADS_SYNC_SECRET</code> (a long random value) in the site&apos;s environment, redeploy, and the connect steps appear here.</p>
          )}
        </div>
      )}
    </Card>
  );
}

const GOOGLE_STATUS: Record<string, [tone: "success" | "warning" | "danger", text: string]> = {
  connected: ["success", "Google connected."],
  declined: ["warning", "Google sign-in was cancelled — nothing changed."],
  "bad-state": ["danger", "That sign-in link had expired. Press Connect Google again."],
  "no-refresh-token": ["danger", "Google didn't grant lasting access. Remove this site at myaccount.google.com → Security → Third-party access, then connect again."],
  "not-configured": ["warning", "Connect Google needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET set first."],
  failed: ["danger", "Google sign-in failed. Try again in a minute."],
};

/** The pieces of the direct connection, each ticked off as it's done. */
function ConnectionCard({ google, status }: { google: { email: string; updatedAt: Date } | null; status?: string }) {
  const steps: [done: boolean, text: string][] = [
    [oauthConfigured(), "Google Cloud project with Google Ads API access, and its sign-in client (GOOGLE_OAUTH_CLIENT_ID / SECRET)"],
    [!!google, google ? `Signed in as ${google.email || "the owner"}` : "Owner signs in with Google"],
  ];
  const live = steps.every(([ok]) => ok);
  const note = status ? GOOGLE_STATUS[status] : undefined;
  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Direct connection to Google</h2>
        {live ? <Badge tone="success">live</Badge> : <Badge tone="neutral">{steps.filter(([ok]) => ok).length} of {steps.length} done</Badge>}
      </div>
      {note && <p className={`mt-2 text-sm ${note[0] === "success" ? "text-success" : note[0] === "warning" ? "text-warning" : "text-danger"}`}>{note[1]}</p>}
      <ul className="mt-3 space-y-1.5 text-[13px]">
        {steps.map(([ok, text]) => (
          <li key={text} className="flex items-center gap-2">
            {ok ? <CircleCheck size={15} className="text-success" aria-hidden /> : <CircleAlert size={15} className="text-muted" aria-hidden />}{text}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">
        Live, this page reads Google Ads and Search Console directly and can block a search or pause a keyword. Until then, the nightly script below fills the same reports.
        {oauthConfigured() && <> Sign-in redirect URI for Google Cloud: <code className="font-mono">{redirectUri()}</code></>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {oauthConfigured() && <a href="/api/admin/google/connect" className="rounded-full border border-navy/20 px-4 py-2 text-xs font-medium hover:border-blue">{google ? "Reconnect Google" : "Connect Google"}</a>}
        {live && <SyncNowButton />}
      </div>
    </Card>
  );
}
