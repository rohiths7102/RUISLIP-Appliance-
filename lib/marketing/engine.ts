import { poaNamesFromDb } from "@/lib/poa";
import { searchAnalytics, type GscRow } from "@/lib/search-console";
import { isNegated } from "@/lib/ads-reports";
import { adminHref } from "@/lib/admin-config";
import { FEED_AVAILABILITY } from "@/lib/merchant-feed";
import { localPageFor, townDepartmentHref } from "@/lib/areas";

/**
 * The marketing engine: every data source the site holds — Google Ads
 * (AdsSnapshot / AdsCampaignDay), Search Console, the site's own call and
 * postcode events, enquiries, the catalogue and price watch — turned into
 *   kpis()     this week against last week
 *   actions()  a ranked to-do list, each with the rule that raised it
 * Admin → Today renders both; the daily job and the weekly report reuse them,
 * so the screen, the email and the automation always agree.
 *
 * Every rule is a plain threshold, stated in the action's `why`. Nothing here
 * changes anything: actions only DESCRIBE a change; applying one goes through
 * the audited admin routes (or the opt-in automation in automation.ts).
 */
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const gbp = (n: number) => `£${n.toFixed(2)}`;

/* ------------------------------------------------------------------ KPIs */

export type Kpi = { label: string; now: number; before: number; money?: boolean; lowerIsBetter?: boolean; neutral?: boolean; perCall?: boolean };

export async function kpis(db: any): Promise<{ from: string; to: string; items: Kpi[] }> {
  const today = new Date();
  const d7 = new Date(today.getTime() - 7 * DAY), d14 = new Date(today.getTime() - 14 * DAY);
  const [days, events, enq] = await Promise.all([
    db.adsCampaignDay.findMany({ where: { date: { gte: iso(d14) } } }).catch(() => []),
    db.trackedEvent.findMany({ where: { createdAt: { gte: d14 } }, select: { type: true, source: true, createdAt: true } }).catch(() => []),
    db.enquiry.findMany({ where: { createdAt: { gte: d14 } }, select: { createdAt: true } }).catch(() => []),
  ]);
  const split = <T,>(rows: T[], at: (r: T) => Date) => [rows.filter((r) => at(r) >= d7), rows.filter((r) => at(r) < d7)];
  const [a7, a14] = split(days, (r: any) => new Date(r.date));
  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  // No calls means no cost per call — NaN, shown as "no calls", never a £0.00 that looks like a win.
  const cpc = (rows: any[]) => (sum(rows, "conversions") ? sum(rows, "cost") / sum(rows, "conversions") : NaN);
  const [e7, e14] = split(events, (r: any) => r.createdAt);
  const count = (rows: any[], type: string, ads?: boolean) => rows.filter((r) => r.type === type && (!ads || r.source === "google-ads")).length;
  const [q7, q14] = split(enq, (r: any) => r.createdAt);
  return {
    from: iso(d7), to: iso(today),
    items: [
      { label: "Ad spend", now: sum(a7, "cost"), before: sum(a14, "cost"), money: true, neutral: true },
      { label: "Calls & enquiries from ads", now: sum(a7, "conversions"), before: sum(a14, "conversions") },
      { label: "Cost per call", now: cpc(a7), before: cpc(a14), money: true, lowerIsBetter: true, perCall: true },
      { label: "Call taps on the website", now: count(e7, "call_click"), before: count(e14, "call_click") },
      { label: "Postcode checks", now: count(e7, "postcode_check"), before: count(e14, "postcode_check") },
      { label: "Enquiries", now: q7.length, before: q14.length },
    ],
  };
}

/* --------------------------------------------------------------- actions */

export type Action = {
  key: string;                // stable id, for dismissing
  area: "Google Ads" | "Leads" | "Prices" | "Shopping feed" | "SEO" | "Chatbot" | "Catalogue" | "Local";
  title: string;
  why: string;                // the rule that raised it, with the numbers
  score: number;              // ranking: roughly £ at stake per month
  cta:
    | { kind: "api"; label: string; action: "block_search" | "pause_keyword"; value: string; confirm: string }
    | { kind: "link"; label: string; href: string; external?: boolean };
};

/** Searches that are the shop's own name: never auto-blocked, flagged instead. */
export const BRAND_WORDS = ["jyotsna", "ruislip", "euronics"];
export const isBrandSearch = (s: string) => BRAND_WORDS.some((w) => s.toLowerCase().includes(w));

export const RULES = {
  wastedSearchSpend: 5,      // £ in 30 days, no conversion → block
  wastedKeywordSpend: 10,    // £ in 30 days, no conversion → pause
  lowQuality: 3,             // quality score ≤ this, with clicks and NO conversions → pause
  staleLeadHours: 24,        // an enquiry still "new" after this → reply
  seoLiftMin: 4, seoLiftMax: 15, seoLiftImpressions: 30,   // page 1 bottom / page 2 → worth a better title
  lowCtrImpressions: 100, lowCtr: 0.01,                     // seen a lot, rarely clicked → rewrite the snippet
  paidButRankFree: 3,        // organic position ≤ this while paying for the same search
  wantedViews: 5,            // product page views in 14 days that make a product "wanted"
  emptySearches: 2,          // the same search with no results this many times in 7 days → add it
};

/**
 * Searches already blocked (by hand or by the automation), from the audit log.
 * The 30-day search report still lists them until they age out, so without
 * this the same "block" would be offered again every day.
 */
export async function blockedSearches(db: any): Promise<Set<string>> {
  const rows = await db.adminAuditLog.findMany({
    where: { entityType: "google-ads", action: { in: ["ads:block_search", "marketing:auto-block"] } },
    select: { newValue: true },
  }).catch(() => []);
  return new Set(rows.map((r: any) => String(r.newValue?.value ?? "").toLowerCase()).filter(Boolean));
}

type Snap = { label: string; detail?: string; key?: string; status?: string; quality?: number | null; clicks: number; cost: number; conversions: number };

export async function actions(db: any, opts: { gsc?: boolean } = {}): Promise<{ list: Action[]; notes: string[] }> {
  const notes: string[] = [];
  const out: Action[] = [];
  const snaps = await db.adsSnapshot.findMany().catch(() => []);
  const rep = (name: string): Snap[] => (snaps.find((s: any) => s.report === name)?.rows as Snap[]) || [];

  // --- Google Ads: searches costing money with no call or enquiry. Skip any
  // the account's negatives already stop (synced from Google), and any blocked
  // since the last sync (audit log).
  const blocked = await blockedSearches(db);
  const negatives = [...rep("negatives"), ...rep("sharedNegatives")];
  for (const r of rep("searchTerms")) {
    if (r.cost < RULES.wastedSearchSpend || r.conversions > 0 || blocked.has(r.label.toLowerCase()) || isNegated(r.label, negatives)) continue;
    const brand = isBrandSearch(r.label);
    out.push({
      key: `ads:search:${r.label}`, area: "Google Ads",
      title: brand ? `Check the search “${r.label}” — no calls` : `Block the search “${r.label}”`,
      why: `${gbp(r.cost)} on ${r.clicks} clicks in 30 days, no calls or enquiries${brand ? " — it mentions Euronics, Ruislip or your shop, so it's left for you to decide" : ""}.`,
      score: r.cost * (brand ? 0.5 : 1),
      cta: { kind: "api", label: "Block search", action: "block_search", value: r.label, confirm: `Stop showing ads for exactly “${r.label}”?` },
    });
  }
  // --- Google Ads: keywords that spend without results, or score badly
  for (const r of rep("keywords")) {
    if (r.status === "PAUSED" || !r.key) continue;
    const waste = r.cost >= RULES.wastedKeywordSpend && r.conversions === 0;
    // A low score alone is no reason to pause a keyword that brings calls.
    const poor = r.quality != null && r.quality <= RULES.lowQuality && r.clicks > 0 && r.conversions === 0;
    if (!waste && !poor) continue;
    out.push({
      key: `ads:keyword:${r.key}`, area: "Google Ads", title: `Pause the keyword “${r.label}”`,
      why: waste ? `${gbp(r.cost)} in 30 days with no calls or enquiries.` : `Google rates it ${r.quality}/10, so every click costs more than it should.`,
      score: waste ? r.cost : r.cost * 0.6,
      cta: { kind: "api", label: "Pause keyword", action: "pause_keyword", value: r.key, confirm: `Pause the keyword “${r.label}”? It can be switched back on in Google Ads.` },
    });
  }
  // --- Google Ads: ads Google rates poor
  for (const r of rep("ads")) {
    if (r.key !== "POOR" || r.status !== "ENABLED") continue;
    out.push({
      key: `ads:ad:${r.label}`, area: "Google Ads", title: `Rewrite the ad “${r.label}”`,
      why: `Google rates its wording “poor”: it wins fewer auctions and pays more per click (${r.clicks} clicks, ${gbp(r.cost)} in 30 days).`,
      score: Math.max(5, r.cost * 0.3),
      cta: { kind: "link", label: "Open in Google Ads", href: "https://ads.google.com/aw/ads", external: true },
    });
  }

  // --- Local: paid searches that name a delivery town. The site has a page for
  // that town (and department); sending the click there, not the homepage,
  // is what makes a local search convert — and the same page is what Google
  // ranks for the free version of the search.
  for (const r of rep("searchTerms")) {
    const local = localPageFor(r.label);
    // A search for the shop itself belongs on the homepage, not a town page.
    if (!local || r.clicks < 2 || isBrandSearch(r.label)) continue;
    const href = local.dept ? townDepartmentHref(local.town.slug, local.dept) : `/areas/${local.town.slug}`;
    out.push({
      key: `local:ads:${r.label}`, area: "Local", title: `Send “${r.label}” ad clicks to ${href}`,
      why: `${r.clicks} clicks (${gbp(r.cost)}) in 30 days for a search naming ${local.town.name}. Your ${local.town.name} page answers it — delivery, fitting, the models — so use it as that ad's final URL.`,
      score: 15 + r.clicks * 2 + r.cost * 0.5, cta: { kind: "link", label: "Open the page", href },
    });
  }

  // --- Leads waiting for a reply
  const stale = await db.enquiry.count({ where: { status: "new", createdAt: { lt: new Date(Date.now() - RULES.staleLeadHours * 3600e3) } } }).catch(() => 0);
  if (stale) out.push({
    key: `leads:stale:${new Date().toISOString().slice(0, 10)}`, area: "Leads",
    title: `Reply to ${stale} enquir${stale === 1 ? "y" : "ies"} waiting over a day`,
    why: `Status still “new” after ${RULES.staleLeadHours} hours; a same-day reply wins most appliance sales.`,
    score: 1000 + stale, cta: { kind: "link", label: "Open Sales & Leads", href: adminHref("enquiries") },
  });

  // --- Prices: any live price that differs from Euronics' latest read. Euronics
  // holds its members to its prices, so this is compliance, not housekeeping:
  // the nightly sync applies nearly every change itself, and what is left here
  // was held by a safety check (a move over 50%, an unconfirmed page).
  const recent = await db.priceObservation.findMany({
    where: { sourceId: "euronics", status: "ok", observedAt: { gte: new Date(Date.now() - 3 * DAY) } },
    orderBy: { observedAt: "desc" },
    select: { productId: true, price: true, product: { select: { priceNow: true } } },
  }).catch(() => []);
  const seen = new Set<string>(); let drift = 0;
  for (const o of recent) {
    if (seen.has(o.productId)) continue; seen.add(o.productId);
    if (o.price != null && o.product?.priceNow != null && Math.abs(o.price - o.product.priceNow) >= 0.01) drift++;
  }
  if (drift) out.push({
    key: `prices:euronics-drift:${drift}`, area: "Prices", title: `${drift} price${drift === 1 ? "" : "s"} don't match Euronics`,
    why: "Euronics' latest price differs from ours and the nightly sync held the change for a person to check (a move over 50%, a page it couldn't confirm, or Sachin's price list saying otherwise). Members are held to Euronics prices, so apply or correct each one.",
    score: 900 + drift, cta: { kind: "link", label: "Open Price watch", href: adminHref("price-watch") },
  });

  // --- Shopping feed: products Google can't advertise
  const poa = await poaNamesFromDb(db).catch(() => new Set<string>());
  const vis = await db.product.findMany({ where: { isVisible: true }, select: { slug: true, productCode: true, title: true, category: true, subcategory: true, brand: true, mainImage: true, priceNow: true, availabilityNormalised: true } }).catch(() => []);
  const sellable = vis.filter((p: any) => !poa.has(p.category) && !poa.has(p.subcategory) && !poa.has(p.brand));
  const noPhoto = sellable.filter((p: any) => !p.mainImage).length;
  if (noPhoto) out.push({
    key: `feed:no-photo:${noPhoto}`, area: "Shopping feed", title: `${noPhoto} products have no photo`,
    why: "Google Shopping rejects products without an image, so these can never appear in Shopping ads or free listings.",
    score: 20 + noPhoto / 5, cta: { kind: "link", label: "See feed health", href: adminHref("ads") },
  });
  // Priced and photographed, but "call to confirm", so Google never lists them.
  // Free listings are the cheapest reach the shop has (Sept 2026: ~210 of ~5,000
  // products reached Google); "available to order" lists them as backorder.
  const notListed = sellable.filter((p: any) => p.priceNow != null && p.mainImage && !FEED_AVAILABILITY.includes(p.availabilityNormalised));
  if (notListed.length >= 20) out.push({
    key: `feed:not-listed:${Math.round(notListed.length / 50)}`, area: "Shopping feed",
    title: `${notListed.length} priced products aren't in Google's free listings`,
    why: `They have a price and a photo but are marked “call to confirm”, so Google Shopping never shows them. Mark the ranges you can get within a few days as “Available to order” (Products → select → set stock) and they list for free — no ad spend.`,
    score: 40 + notListed.length / 20, cta: { kind: "link", label: "Open Products", href: adminHref("products") },
  });

  // --- Catalogue: what visitors are asking for, from the site's own anonymous
  // events. A product people open but can't buy, and a search that found
  // nothing, are the closest thing to a customer saying what to stock.
  const views: { productSlug: string }[] = await db.trackedEvent.findMany({
    where: { type: "page_view", productSlug: { not: "" }, createdAt: { gte: new Date(Date.now() - 14 * DAY) } }, select: { productSlug: true },
  }).catch(() => []);
  const viewsBySlug = new Map<string, number>();
  for (const v of views) viewsBySlug.set(v.productSlug, (viewsBySlug.get(v.productSlug) || 0) + 1);
  const wanted = sellable.map((p: any) => ({ ...p, views: viewsBySlug.get(p.slug) || 0 })).filter((p: any) => p.views >= RULES.wantedViews).sort((a: any, b: any) => b.views - a.views);
  for (const p of wanted.filter((p: any) => p.priceNow == null).slice(0, 3)) out.push({
    key: `catalogue:price:${p.slug}`, area: "Catalogue", title: `Put a price on ${p.title.slice(0, 60)}`,
    why: `Opened ${p.views} times in 14 days but shows “call for best pricing”; a visible price is what turns a look into a call, and lets Google list it.`,
    score: 50 + p.views * 3, cta: { kind: "link", label: "Edit product", href: `${adminHref("products")}?q=${encodeURIComponent(p.productCode)}` },
  });
  for (const p of wanted.filter((p: any) => p.priceNow != null && p.mainImage && !FEED_AVAILABILITY.includes(p.availabilityNormalised)).slice(0, 3)) out.push({
    key: `catalogue:stock:${p.slug}`, area: "Catalogue", title: `Mark ${p.title.slice(0, 60)} in stock or available to order`,
    why: `Opened ${p.views} times in 14 days, priced and photographed, but “call to confirm” keeps it out of Google Shopping's free listings.`,
    score: 30 + p.views * 2, cta: { kind: "link", label: "Edit product", href: `${adminHref("products")}?q=${encodeURIComponent(p.productCode)}` },
  });
  const empties: { path: string }[] = await db.trackedEvent.findMany({
    where: { type: "search", isLocal: false, createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, select: { path: true },
  }).catch(() => []);
  const byTerm = new Map<string, number>();
  for (const e of empties) byTerm.set(e.path, (byTerm.get(e.path) || 0) + 1);
  for (const [term, times] of [...byTerm].filter(([, n]) => n >= RULES.emptySearches).sort((a, b) => b[1] - a[1]).slice(0, 3)) out.push({
    key: `catalogue:search:${term}`, area: "Catalogue", title: `Stock or list “${term}” — people searched for it and found nothing`,
    why: `Searched ${times} times on the site this week with no result. If you can get it, add it (Quick add) so the next search — and Google — finds it.`,
    score: 25 + times * 5, cta: { kind: "link", label: "Quick add", href: adminHref("products") },
  });

  // --- Chat assistant: down (customers only got the phone number), or asked
  // things it couldn't find — a product listed under another name, one to add,
  // or shop information to fill in. The owner's own tests don't count.
  const chatSince = (days: number) => ({ gte: new Date(Date.now() - days * DAY) });
  const [chatDown, chatGaps] = await Promise.all([
    db.chatTurn.count({ where: { outcome: "fallback", createdAt: chatSince(1), NOT: { source: "admin" } } }).catch(() => 0),
    db.chatTurn.count({ where: { outcome: { in: ["no_match", "unsure"] }, createdAt: chatSince(7), NOT: { source: "admin" } } }).catch(() => 0),
  ]);
  if (chatDown) out.push({
    key: `chat:down:${new Date().toISOString().slice(0, 10)}`, area: "Chatbot",
    title: `The chat assistant couldn't answer ${chatDown} customer${chatDown === 1 ? "" : "s"} today`,
    why: "Neither Groq nor Gemini replied (a quota, an expired key or an outage), so those customers were only given the phone number.",
    score: 600 + chatDown, cta: { kind: "link", label: "Open Chatbot", href: adminHref("chatbot") },
  });
  if (chatGaps >= 3) out.push({
    key: `chat:gaps:${chatGaps}`, area: "Chatbot", title: `${chatGaps} chat questions this week had no answer`,
    why: "Customers asked the website assistant about things it couldn't find in the catalogue or the shop information.",
    score: 30 + chatGaps, cta: { kind: "link", label: "Read them", href: `${adminHref("chatbot")}?show=unanswered` },
  });

  // --- SEO, from Search Console
  if (opts.gsc !== false) {
    try {
      const [pages, queries] = await Promise.all([searchAnalytics(db, "page"), searchAnalytics(db, "query")]);
      if (pages === null) notes.push("Search Console isn't connected — SEO actions are off.");
      for (const p of (pages || []).filter((x) => x.position >= RULES.seoLiftMin && x.position <= RULES.seoLiftMax && x.impressions >= RULES.seoLiftImpressions).slice(0, 6)) {
        const path = p.key.replace(/^https?:\/\/[^/]+/, "") || "/";
        out.push({
          key: `seo:lift:${path}`, area: "SEO", title: `Lift ${path} from position ${p.position.toFixed(1)} to the top 3`,
          why: `Seen ${p.impressions} times in Google in 28 days but sits at #${p.position.toFixed(1)}; a sharper title and description that name the town and the product usually moves it up.`,
          score: p.impressions / 20, cta: { kind: "link", label: "Edit title & description", href: adminHref("seo") },
        });
      }
      for (const q of (queries || []).filter((x) => x.impressions >= RULES.lowCtrImpressions && x.ctr < RULES.lowCtr && x.position <= 10).slice(0, 5)) {
        out.push({
          key: `seo:ctr:${q.key}`, area: "SEO", title: `People see you for “${q.key}” but rarely click`,
          why: `${q.impressions} views, ${(q.ctr * 100).toFixed(1)}% clicked, at position ${q.position.toFixed(1)}. The title Google shows isn't answering the search.`,
          score: q.impressions / 25, cta: { kind: "link", label: "Open SEO", href: adminHref("seo") },
        });
      }
      const organic = new Map((queries || []).map((q: GscRow) => [q.key.toLowerCase(), q]));
      for (const r of rep("searchTerms")) {
        const o = organic.get(r.label.toLowerCase());
        if (!o || o.position > RULES.paidButRankFree || r.cost < 3) continue;
        out.push({
          key: `seo:paid-free:${r.label}`, area: "SEO", title: `You rank #${o.position.toFixed(1)} for free for “${r.label}”`,
          why: `…and spent ${gbp(r.cost)} on ads for the same search in 30 days. Worth testing a lower bid there.`,
          score: r.cost * 0.4, cta: { kind: "link", label: "Paid vs free", href: adminHref("seo") },
        });
      }
    } catch (e: any) {
      notes.push(`Search Console: ${(e?.message || "no answer").replace(/^Search Console: /, "")} — SEO actions skipped.`);
    }
  }

  // Hide what the owner dismissed, then rank.
  // Optional chaining: a deploy whose schema lags the code must not take the page down.
  const dismissed = new Set<string>(((await db.actionDismissal?.findMany({ where: { until: { gt: new Date() } }, select: { key: true } }).catch(() => [])) ?? []).map((d: any) => d.key));
  if (!snaps.length) notes.push("No Google Ads data yet — press Sync now on the Google Ads page.");
  return { list: out.filter((a) => !dismissed.has(a.key)).sort((a, b) => b.score - a.score), notes };
}
