/**
 * Admin → Live: what is happening on the site right now, from the site's own
 * anonymous beacon (TrackedEvent: page_view / call_click / postcode_check),
 * the enquiry pipeline, and the crawl log (TrackedEvent "bot_crawl", written by
 * middleware → /api/track/crawl). Google's own figures are added by the API
 * route (lib/search-console.ts searchFresh). No personal data leaves here:
 * enquiries are shown by product and status only.
 *
 * "Today" is the UK day; it is compared with yesterday up to the same time of
 * day, so a morning never looks worse than a whole day.
 */
const DAY = 86_400_000;

/** Epoch ms of UK midnight, `back` days ago. */
function ukMidnight(back = 0): number {
  const now = new Date();
  const d = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const offset = d.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - offset - back * DAY;
}
const host = (r: string) => r.replace(/^www\./, "");

type Ev = { type: string; path: string; productSlug: string; source: string; referrer: string; landing: boolean; createdAt: Date };

export async function liveSnapshot(db: any) {
  const now = Date.now(), today = ukMidnight(0), yday = today - DAY;
  const ev: Ev[] = await db.trackedEvent.findMany({
    where: { createdAt: { gte: new Date(yday) } },
    select: { type: true, path: true, productSlug: true, source: true, referrer: true, landing: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const human = ev.filter((e) => e.type !== "bot_crawl"), crawl = ev.filter((e) => e.type === "bot_crawl");
  const t = (e: Ev) => e.createdAt.getTime();

  const kpis = (list: Ev[]) => ({
    visits: list.filter((e) => e.type === "page_view" && e.landing).length,
    pageViews: list.filter((e) => e.type === "page_view").length,
    productViews: list.filter((e) => e.type === "page_view" && e.productSlug).length,
    calls: list.filter((e) => e.type === "call_click").length,
    postcodes: list.filter((e) => e.type === "postcode_check").length,
  });
  const todayEv = human.filter((e) => t(e) >= today);
  const ydayEv = human.filter((e) => t(e) < today && t(e) <= now - DAY);

  // Enquiries: by product and status only.
  const enq: { productTitle: string; status: string; quotedPrice: number | null; createdAt: Date }[] = await db.enquiry.findMany({
    where: { createdAt: { gte: new Date(ukMidnight(31)) } },
    select: { productTitle: true, status: true, quotedPrice: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const monthStart = (() => { const d = new Date(today); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); })();
  const won = enq.filter((e) => ["won", "closed"].includes(e.status) && e.createdAt.getTime() >= monthStart);

  // Per hour, last 24 hours: people vs Google's crawler.
  const hours = Array.from({ length: 24 }, (_, i) => {
    const end = now - (23 - i) * 3_600_000, start = end - 3_600_000;
    const at = (e: Ev) => t(e) > start && t(e) <= end;
    return {
      label: new Date(end).toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Europe/London" }),
      views: human.filter((e) => e.type === "page_view" && at(e)).length,
      visits: human.filter((e) => e.type === "page_view" && e.landing && at(e)).length,
      productViews: human.filter((e) => e.type === "page_view" && e.productSlug && at(e)).length,
      calls: human.filter((e) => e.type === "call_click" && at(e)).length,
      crawls: crawl.filter(at).length,
    };
  });

  // What people are looking at today, and where they came from.
  const tally = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const topSlugs = tally(todayEv.filter((e) => e.type === "page_view" && e.productSlug).map((e) => e.productSlug)).slice(0, 8);
  const feed = human.slice(0, 30);
  const slugs = [...new Set([...topSlugs.map(([s]) => s), ...feed.map((e) => e.productSlug).filter(Boolean)])];
  const prods: { slug: string; title: string; brand: string; priceNow: number | null; mainImage: string }[] = slugs.length
    ? await db.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true, title: true, brand: true, priceNow: true, mainImage: true } })
    : [];
  const bySlug = new Map(prods.map((p) => [p.slug, p]));
  const sourceOf = (e: Ev) => e.source === "google-ads" ? "Google Ads" : e.referrer ? host(e.referrer) : "Direct / typed";

  return {
    at: new Date(now).toISOString(),
    rightNow: {
      views5: human.filter((e) => e.type === "page_view" && now - t(e) <= 5 * 60_000).length,
      visits30: human.filter((e) => e.type === "page_view" && e.landing && now - t(e) <= 30 * 60_000).length,
      views30: human.filter((e) => e.type === "page_view" && now - t(e) <= 30 * 60_000).length,
    },
    today: { ...kpis(todayEv), enquiries: enq.filter((e) => e.createdAt.getTime() >= today).length },
    yesterday: { ...kpis(ydayEv), enquiries: enq.filter((e) => e.createdAt.getTime() >= yday && e.createdAt.getTime() < today && e.createdAt.getTime() <= now - DAY).length },
    sales: {
      wonThisMonth: won.length,
      wonValue: won.reduce((s, e) => s + (e.quotedPrice || 0), 0),
      open: enq.filter((e) => ["new", "contacted", "quoted"].includes(e.status)).length,
      openValue: enq.filter((e) => ["new", "contacted", "quoted"].includes(e.status)).reduce((s, e) => s + (e.quotedPrice || 0), 0),
      recent: enq.slice(0, 6).map((e) => ({ product: e.productTitle, status: e.status, at: e.createdAt.toISOString() })),
    },
    hours,
    topProducts: topSlugs.map(([slug, views]) => ({ ...(bySlug.get(slug) || { title: slug, brand: "", priceNow: null, mainImage: "" }), slug, views })),
    sources: tally(todayEv.filter((e) => e.type === "page_view" && e.landing).map(sourceOf)).slice(0, 6).map(([name, visits]) => ({ name, visits })),
    feed: feed.map((e) => ({
      type: e.type, at: e.createdAt.toISOString(), path: e.path, from: e.landing ? sourceOf(e) : "",
      product: e.productSlug ? bySlug.get(e.productSlug)?.title || e.productSlug : "",
    })),
    crawl: {
      last24h: crawl.length,
      verified: crawl.filter((e) => e.landing).length,
      pages: new Set(crawl.map((e) => e.path)).size,
      byBot: tally(crawl.map((e) => e.source)).map(([bot, hits]) => ({ bot, hits })),
      recent: crawl.slice(0, 15).map((e) => ({ bot: e.source, path: e.path, verified: e.landing, at: e.createdAt.toISOString() })),
    },
  };
}
export type LiveSnapshot = Awaited<ReturnType<typeof liveSnapshot>>;
