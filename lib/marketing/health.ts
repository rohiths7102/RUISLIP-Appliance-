/**
 * Is everything in sync? One check per moving part, each with when it last
 * happened and where to fix it. Shown on the dashboard so a stale feed or a
 * stopped job is seen the same morning, not weeks later.
 */
import { poaNamesFromDb } from "@/lib/poa";
import { adminHref } from "@/lib/admin-config";
import { groqConfigured } from "@/lib/chat/groq";

const DAY = 86_400_000;
export type Health = { name: string; status: "ok" | "warn" | "off"; detail: string; href: string };

const ago = (d: Date | null) => {
  if (!d) return "never";
  const h = (Date.now() - d.getTime()) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)} days ago`;
};

export async function health(db: any): Promise<Health[]> {
  const poa = [...(await poaNamesFromDb(db).catch(() => new Set<string>()))];
  const [lastPrice, priced24h, lastAds, google, cron, gclidLeads, reported, sales, inFeed, chats, chatDown] = await Promise.all([
    db.priceObservation.findFirst({ where: { sourceId: "euronics" }, orderBy: { observedAt: "desc" }, select: { observedAt: true } }).catch(() => null),
    db.priceObservation.count({ where: { sourceId: "euronics", observedAt: { gte: new Date(Date.now() - DAY) } } }).catch(() => 0),
    db.adsSnapshot.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }).catch(() => null),
    db.googleConnection.findUnique({ where: { id: "google" }, select: { email: true, scopes: true } }).catch(() => null),
    db.adminAuditLog.findFirst({ where: { action: "marketing:daily" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    db.enquiry.count({ where: { gclid: { not: "" } } }).catch(() => 0),
    db.enquiry.count({ where: { saleReportedAt: { not: null } } }).catch(() => 0),
    // Only a sale that came from an ad click can be reported, so only those count.
    db.enquiry.count({ where: { status: { in: ["won", "closed"] }, gclid: { not: "" } } }).catch(() => 0),
    // The merchant feed's own gate (app/merchant-feed.xml): what Google can actually advertise.
    db.product.count({ where: {
      isVisible: true, priceNow: { not: null }, mainImage: { not: "" }, availabilityNormalised: { in: ["in_stock", "limited"] },
      ...(poa.length && { NOT: [{ category: { in: poa } }, { subcategory: { in: poa } }, { brand: { in: poa } }] }),
    } }).catch(() => 0),
    // Customers' questions this week (the owner's own tests aside), and answers the AI never wrote.
    db.chatTurn.groupBy({ by: ["outcome"], where: { createdAt: { gte: new Date(Date.now() - 7 * DAY) }, NOT: { source: "admin" } }, _count: { _all: true } }).catch(() => []),
    db.chatTurn.count({ where: { outcome: "fallback", createdAt: { gte: new Date(Date.now() - DAY) }, NOT: { source: "admin" } } }).catch(() => 0),
  ]);
  const asked = chats.reduce((t: number, c: any) => t + c._count._all, 0);
  const gaps = chats.filter((c: any) => ["no_match", "unsure"].includes(c.outcome)).reduce((t: number, c: any) => t + c._count._all, 0);
  const fresh = (d: Date | null, hours: number) => !!d && Date.now() - d.getTime() < hours * 3_600_000;
  const priceAt = lastPrice?.observedAt ?? null, adsAt = lastAds?.syncedAt ?? null, cronAt = cron?.createdAt ?? null;
  return [
    { name: "Euronics prices", status: fresh(priceAt, 30) ? "ok" : "warn", href: adminHref("price-watch"),
      detail: `${priced24h.toLocaleString("en-GB")} lines checked in the last 24h · last ${ago(priceAt)}` },
    // Data can arrive from the direct connection or the nightly Ads Script — either keeps it fresh.
    { name: "Google Ads data", status: fresh(adsAt, 30) ? "ok" : adsAt || google ? "warn" : "off", href: adminHref("ads"),
      detail: adsAt || google ? `synced ${ago(adsAt)}${google ? ` · signed in as ${google.email || "the owner"}` : ""}` : "not connected — Connect Google on the Google Ads page" },
    { name: "Search Console", status: google?.scopes?.includes("webmasters") ? "ok" : "off", href: adminHref("seo"),
      detail: google?.scopes?.includes("webmasters") ? "connected — free-search data on the SEO page" : "not connected" },
    { name: "Daily engine run", status: !process.env.CRON_SECRET ? "off" : fresh(cronAt, 30) ? "ok" : "warn", href: adminHref("today"),
      detail: !process.env.CRON_SECRET ? "not switched on yet — needs the CRON_SECRET setting in Vercel" : `last run ${ago(cronAt)}` },
    { name: "Sales reported to Google", status: reported < sales ? "warn" : "ok", href: adminHref("enquiries"),
      detail: `${reported} of ${sales} ad-click sales sent to Google · ${gclidLeads} enquiries carry an ad click` },
    { name: "Shopping feed", status: inFeed > 0 ? "ok" : "warn", href: adminHref("ads"),
      detail: `${inFeed.toLocaleString("en-GB")} products Google can advertise · Merchant Center fetches the feed daily at 7am` },
    { name: "Chat assistant", status: !groqConfigured() ? "off" : chatDown ? "warn" : "ok", href: adminHref("chatbot"),
      detail: !groqConfigured() ? "no AI key set — the chat only offers the phone number"
        : chatDown ? `couldn't reach the AI ${chatDown} time${chatDown === 1 ? "" : "s"} in 24h — those customers got the phone number instead`
          : `${asked} question${asked === 1 ? "" : "s"} this week${gaps ? ` · ${gaps} it couldn't answer` : ""}` },
  ];
}
