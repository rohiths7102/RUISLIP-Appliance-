import { searchAnalytics } from "@/lib/search-console";
import { TOWNS } from "@/lib/areas";
import { CHANNELS, channelOf, type Channel } from "@/lib/marketing/channels";

/**
 * Admin → Telemetry: every step from being seen on Google to a sale, for one
 * period, split by where the customer came from. Sources:
 *   Google Ads     AdsCampaignDay (impressions, clicks, spend)
 *   Google search  Search Console by date (impressions, clicks) — if connected
 *   the site       TrackedEvent: page_view (landing = a visit), call_click, postcode_check
 *   sales          Enquiry (won + quoted value), credited by Enquiry.adSource
 * Channels come from the tagged source (gclid → Google Ads) or the referring host.
 */
const DAY = 86_400_000;
export { CHANNELS, channelOf, type Channel };

type Row = { visits: number; views: number; productViews: number; calls: number; postcodes: number; enquiries: number; sales: number; salesValue: number };
const blank = (): Row => ({ visits: 0, views: 0, productViews: 0, calls: 0, postcodes: 0, enquiries: 0, sales: 0, salesValue: 0 });

export async function telemetry(db: any, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const sinceIso = since.toISOString().slice(0, 10);
  // Visits have only been counted since the first page_view; calls and postcode
  // checks for much longer. The funnel and the channel table count every
  // website step from the same start, or a month of calls against a day of
  // visits reads as a 300% contact rate.
  const firstView = await db.trackedEvent.findFirst({ where: { type: "page_view" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }).catch(() => null);
  const siteSince = firstView && firstView.createdAt > since ? firstView.createdAt : since;
  const [events, enquiries, adsDays, gsc] = await Promise.all([
    db.trackedEvent.findMany({ where: { createdAt: { gte: since } }, select: { type: true, path: true, productSlug: true, postcode: true, source: true, referrer: true, landing: true, createdAt: true } }).catch(() => []),
    db.enquiry.findMany({ where: { createdAt: { gte: since } }, select: { status: true, quotedPrice: true, adSource: true, createdAt: true, productCode: true } }).catch(() => []),
    db.adsCampaignDay.findMany({ where: { date: { gte: sinceIso } } }).catch(() => []),
    searchAnalytics(db, "date", days).catch(() => null),
  ]);

  // ---- per channel
  const byChannel = new Map<Channel, Row>(CHANNELS.map((c) => [c, blank()]));
  for (const e of events) {
    if (e.createdAt < siteSince) continue;
    const r = byChannel.get(channelOf(e.source, e.landing ? e.referrer : ""))!;
    if (e.type === "page_view") { r.views++; if (e.landing) r.visits++; if (e.productSlug) r.productViews++; }
    else if (e.type === "call_click") r.calls++;
    else if (e.type === "postcode_check") r.postcodes++;
  }
  const won = (q: any) => q.status === "won" || q.status === "closed";
  for (const q of enquiries) {
    if (q.createdAt < siteSince) continue;
    const r = byChannel.get(channelOf(q.adSource || ""))!;
    r.enquiries++;
    if (won(q)) { r.sales++; r.salesValue += q.quotedPrice || 0; }
  }
  const total = [...byChannel.values()].reduce((t, r) => { for (const k of Object.keys(t) as (keyof Row)[]) t[k] += r[k]; return t; }, blank());

  // ---- Google, paid and free
  const ads = adsDays.reduce((a: any, d: any) => ({ impressions: a.impressions + d.impressions, clicks: a.clicks + d.clicks, cost: a.cost + d.cost, conversions: a.conversions + d.conversions }), { impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  const organic = gsc ? gsc.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks }), { impressions: 0, clicks: 0 }) : null;

  // ---- daily series
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * DAY).toISOString().slice(0, 10));
  const series = new Map(dayKeys.map((k) => [k, { visits: 0, calls: 0, enquiries: 0, adClicks: 0 }]));
  for (const e of events) {
    const s = series.get(e.createdAt.toISOString().slice(0, 10)); if (!s) continue;
    if (e.type === "page_view" && e.landing) s.visits++;
    if (e.type === "call_click") s.calls++;
  }
  for (const q of enquiries) { const s = series.get(q.createdAt.toISOString().slice(0, 10)); if (s) s.enquiries++; }
  for (const d of adsDays) { const s = series.get(d.date); if (s) s.adClicks += d.clicks; }

  // ---- where visits land, what gets looked at, what makes the phone ring
  const count = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const landings = count(events.filter((e: any) => e.type === "page_view" && e.landing).map((e: any) => e.path)).slice(0, 10);
  const viewed = count(events.filter((e: any) => e.type === "page_view" && e.productSlug).map((e: any) => e.productSlug));
  const calledFor = new Map(count(events.filter((e: any) => e.type === "call_click" && e.productSlug).map((e: any) => e.productSlug)));
  // Won enquiries name a product code; the site's pages are keyed by slug.
  const wonCodes = enquiries.filter((q: any) => won(q) && q.productCode).map((q: any) => q.productCode);
  const codeToSlug = new Map<string, string>(wonCodes.length
    ? (await db.product.findMany({ where: { productCode: { in: wonCodes } }, select: { productCode: true, slug: true } }).catch(() => [])).map((p: any) => [p.productCode, p.slug])
    : []);
  const salesBySlug = new Map<string, number>();
  for (const code of wonCodes) { const slug = codeToSlug.get(code); if (slug) salesBySlug.set(slug, (salesBySlug.get(slug) || 0) + 1); }
  const products = viewed.slice(0, 12).map(([slug, v]) => ({ slug, views: v, calls: calledFor.get(slug) || 0, sales: salesBySlug.get(slug) || 0 }));
  const aiHosts = count(events.filter((e: any) => e.type === "page_view" && e.landing && channelOf(e.source, e.referrer) === "AI assistants").map((e: any) => e.referrer));

  // ---- towns: town-page visits + postcode checks mapped to the town's district
  const districtTown = new Map<string, string>(); for (const t of TOWNS) for (const d of t.districts) if (!districtTown.has(d)) districtTown.set(d, t.name);
  const towns = new Map<string, { pageVisits: number; postcodeChecks: number }>();
  const bump = (name: string, k: "pageVisits" | "postcodeChecks") => { const t = towns.get(name) || { pageVisits: 0, postcodeChecks: 0 }; t[k]++; towns.set(name, t); };
  for (const e of events) {
    if (e.type === "page_view" && e.path.startsWith("/areas/")) { const t = TOWNS.find((x) => `/areas/${x.slug}` === e.path); if (t) bump(t.name, "pageVisits"); }
    if (e.type === "postcode_check" && e.postcode) { const d = e.postcode.replace(/\s.*$/, "").replace(/\d[A-Z]{2}$/, ""); bump(districtTown.get(d) || `${d || "?"} (outside the list)`, "postcodeChecks"); }
  }

  // ---- hour of day (UK time), visits
  const hours = Array.from({ length: 24 }, () => 0);
  const ukHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" });
  for (const e of events) if (e.type === "page_view" && e.landing) hours[Number(ukHour.format(e.createdAt))]++;

  const liveNow = events.filter((e: any) => e.type === "page_view" && e.createdAt > new Date(Date.now() - 30 * 60_000)).length;

  return {
    days, siteSince, partial: siteSince > since, total, byChannel: [...byChannel.entries()].map(([channel, r]) => ({ channel, ...r })),
    ads, organic, series: dayKeys.map((k) => ({ date: k, ...series.get(k)! })),
    landings, products, aiHosts,
    towns: [...towns.entries()].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.pageVisits + b.postcodeChecks - (a.pageVisits + a.postcodeChecks)).slice(0, 15),
    hours, liveNow,
  };
}
