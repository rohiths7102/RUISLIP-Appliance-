import { fetchPage, collectJsonLdProducts, parsePrice } from "@/lib/page-reader";
import { readMakerPrice, MAKER_HOSTS } from "@/lib/maker-price";
import { isPoaProduct, poaNamesFromDb } from "@/lib/poa";

/**
 * Pricewire (Admin → Pricewire, Oct 2026): maps a price onto every Bosch, Neff
 * and Siemens product from websites the owner chooses.
 *
 *   Sites   where prices can be read. Two kinds:
 *             "list"  a published price list, one line per model with its £
 *                     price (llms.txt style). Ruislip Appliances publishes one
 *                     covering everything they sell: one request, no scraping.
 *             "page"  a product page, {code} in the address where the model
 *                     number goes. Bosch, Neff and Siemens are built in; the
 *                     owner can add any other site and test it before use.
 *   Brands  each picks a main site and, optionally, a backup site for models
 *           the main one has no price for.
 *
 * Every read is saved as a PriceObservation under the site's id, and
 * BrandPriceItem.siteId records the site each product follows. The price
 * agent (auto-apply.ts) applies a site's reads only to the products that
 * follow it, so two sites never fight over one price.
 *
 * Runs at 05:00 (vercel.json, /api/cron/maker-prices), whenever n8n calls
 * /api/price-ingest/pricewire, and from "Read prices now". Page reads go
 * stalest first until `deadlineMs`, a few at a time: Bosch's site answered
 * every request with a block page after ~1,000 pages in two minutes at eight
 * in parallel (26 Oct 2026). A product not reached, or whose page could not
 * be read (blocked, slow, down), keeps its last mapping and is counted, never
 * dropped silently — a page that was not read says nothing about the price.
 */
export const FEED_BRANDS = ["Bosch", "Neff", "Siemens"] as const;
export type FeedBrand = (typeof FEED_BRANDS)[number];
/** Maker prices read before Pricewire (best sellers, the Oracle collector). Gated like a site. */
export const LEGACY_MAKER_SOURCE = "manufacturer-rrp";

export const BUILT_IN_SITES = [
  { id: "ruislip-appliances", name: "Ruislip Appliances", kind: "list", url: "https://www.ruislipappliances.com/llms-full.txt" },
  { id: "bosch-home", name: "Bosch", kind: "page", url: "https://www.bosch-home.co.uk/en/product/{code}" },
  { id: "neff-home", name: "Neff", kind: "page", url: "https://www.neff-home.com/uk/en/product/{code}" },
  { id: "siemens-home", name: "Siemens", kind: "page", url: "https://www.siemens-home.bsh-group.com/uk/en/mkt-product/{code}" },
] as const;
const DEFAULT_FEEDS: Record<FeedBrand, { siteId: string; fallbackSiteId: string }> = {
  Bosch: { siteId: "ruislip-appliances", fallbackSiteId: "bosch-home" },
  Neff: { siteId: "ruislip-appliances", fallbackSiteId: "neff-home" },
  // Siemens' own UK site shows no prices; Ruislip Appliances is the only source.
  Siemens: { siteId: "ruislip-appliances", fallbackSiteId: "" },
};

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const brandOf = (s: string): FeedBrand | null => FEED_BRANDS.find((b) => b.toLowerCase() === String(s).trim().toLowerCase()) ?? null;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** A site id from its name: "Marks Electrical" → "marks-electrical". */
export const siteIdFrom = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/* ------------------------------------------------------------ reading */

export type ListLine = { code: string; title: string; price: number; inStock: boolean; brand: FeedBrand | null; section: string; url: string };

/**
 * A published list: "- [title](…/CODE.md): £1,234.00, In stock" under
 * "## Section" headings (Ruislip Appliances' llms-full.txt). The model code is
 * the link's last path part. Graded (ex-display) stock is one-off units, never
 * the model's price, so the list stops there.
 */
export function parseListSite(text: string): Map<string, ListLine> {
  const out = new Map<string, ListLine>();
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      if (/graded/i.test(section)) break;
      continue;
    }
    const m = line.match(/^\s*[-*] \[(.*)\]\((https?:\/\/[^)\s]+?)\/([^/)?#\s]+?)(?:\.(?:md|htm|html))?\)\s*:\s*£([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*,?\s*(.*)$/);
    if (!m) continue;
    const code = decodeURIComponent(m[3]);
    const price = Number(m[4].replace(/,/g, ""));
    if (!(price > 0) || out.has(norm(code))) continue;
    const b = m[1].match(/(?:^|[^a-z])(bosch|neff|siemens)/i);
    out.set(norm(code), {
      code, title: m[1].trim(), price, inStock: /^in stock/i.test(m[5].trim()),
      brand: b ? brandOf(b[1]) : null, section, url: `${m[2]}/${m[3]}${/\.md\)/.test(line) ? ".htm" : ""}`,
    });
  }
  return out;
}

export type PageRead = { price: number; inStock: boolean | null } | { price: null; status: "no_price" | "discontinued" | "other_model" | "prices_disagree" };

/**
 * A price from a product page. Bosch, Neff and Siemens pages go through the
 * maker reader (it knows their on-screen price and their retailer lists).
 * Any other site: the page's structured product data must name the model, and
 * its own Offer price is read; a marketplace AggregateOffer is not a price.
 */
export function readPagePrice(html: string, code: string, url: string): PageRead {
  if (MAKER_HOSTS.test(host(url)) || MAKER_HOSTS.test(`www.${host(url)}`)) {
    const r = readMakerPrice(html, code);
    return r.price !== null ? { price: r.price, inStock: r.inStock } : { price: null, status: r.reason };
  }
  const products = collectJsonLdProducts(html);
  const about = products.filter((p) => [p.mpn, p.sku, p.productID, p.model].some((v) => norm(v) === norm(code)) || norm(p.name).includes(norm(code)));
  if (!about.length) return { price: null, status: products.length ? "other_model" : "no_price" };
  for (const p of about) {
    for (const o of Array.isArray(p.offers) ? p.offers : [p.offers]) {
      if (!o || !/^Offer$/i.test(String(o["@type"] || "Offer"))) continue;
      const price = parsePrice(o.price ?? o.priceSpecification?.price);
      if (price !== null && price > 0) return { price, inStock: o.availability ? /InStock/i.test(String(o.availability)) : null };
    }
  }
  return { price: null, status: "no_price" };
}

/** The page address for one product: its own stored page when that is on the site, else the site's address with {code}. */
export const pageUrlFor = (siteUrl: string, code: string, ownUrl = "") =>
  ownUrl && host(ownUrl) && host(ownUrl) === host(siteUrl) ? ownUrl : siteUrl.replace(/\{code\}/gi, encodeURIComponent(code));

type Fetcher = (url: string) => Promise<{ html: string }>;

/** Admin → Pricewire → Test: what a site says for one model, read now, saved nowhere. */
export async function testSite(site: { kind: string; url: string }, code: string, fetcher: Fetcher = fetchPage) {
  if (site.kind === "list") {
    const list = parseListSite((await fetcher(site.url)).html);
    const line = list.get(norm(code));
    return { listed: list.size, url: site.url, ...(line ? { price: line.price, inStock: line.inStock, title: line.title } : { price: null, status: list.size ? "not_listed" : "no_prices_in_list" }) };
  }
  const url = pageUrlFor(site.url, code);
  const r = readPagePrice((await fetcher(url)).html, code, url);
  return { url, ...r };
}

/* -------------------------------------------------------------- setup */

/** Built-in sites, their price sources and the three brand rows, created on first use. */
export async function ensurePricewire(db: any) {
  for (const s of BUILT_IN_SITES) {
    await db.priceSite.upsert({ where: { id: s.id }, update: {}, create: { ...s, builtIn: true } });
    await db.priceSource.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, label: s.name, kind: "authorised", priceIncludesVat: true, allowAutoApply: true, enabled: true } });
  }
  for (const brand of FEED_BRANDS) await db.brandPriceFeed.upsert({ where: { brand }, update: {}, create: { brand, ...DEFAULT_FEEDS[brand] } });
}

/** The products whose price follows `sourceId`. */
export async function followers(db: any, sourceId: string): Promise<Set<string>> {
  const rows = await db.brandPriceItem.findMany({ where: { siteId: sourceId }, select: { productId: true } });
  return new Set(rows.map((r: any) => r.productId));
}

/** Sources that only ever price the products following them: every site, and the old maker source. */
export async function pricewireSourceIds(db: any): Promise<Set<string>> {
  const sites = await db.priceSite?.findMany({ select: { id: true } }).catch(() => []) ?? [];
  return new Set([LEGACY_MAKER_SOURCE, ...BUILT_IN_SITES.map((s) => s.id), ...sites.map((s: any) => s.id)]);
}

/* ---------------------------------------------------------------- run */

export type BrandTally = { products: number; priced: number; bySite: Record<string, number>; noPrice: number; left: number; unread: number };
export type SiteTally = { read: number; priced: number; error: string };
/** Page reads in a row that fail before a site is left alone for the rest of the run. */
export const PAUSE_AFTER_FAILURES = 10;
export type PricewireRun = { brands: Record<string, BrandTally>; sites: Record<string, SiteTally> };

type Read = { siteId: string; price: number | null; inStock: boolean | null; status: string; url: string; observed: boolean };

export async function syncPricewire(db: any, opts: { deadlineMs?: number; concurrency?: number; fetcher?: Fetcher } = {}): Promise<PricewireRun> {
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? 40_000;
  const fetcher = opts.fetcher ?? fetchPage;
  await ensurePricewire(db);
  const sites = new Map<string, any>((await db.priceSite.findMany()).map((s: any) => [s.id, s]));
  const allFeeds = await db.brandPriceFeed.findMany();
  // A brand switched off follows no site, so nothing is applied to it.
  const off = allFeeds.filter((f: any) => !f.enabled).map((f: any) => f.brand);
  if (off.length) await db.brandPriceItem.updateMany({ where: { brand: { in: off } }, data: { siteId: "" } });
  const usable = (id: string) => (id && sites.get(id)?.enabled ? sites.get(id) : null);
  const feeds = allFeeds.filter((f: any) => f.enabled && usable(f.siteId));
  const run: PricewireRun = { brands: {}, sites: {} };
  const siteTally = (id: string) => (run.sites[id] ??= { read: 0, priced: 0, error: "" });
  if (!feeds.length) return run;

  // Every list site in use, read once.
  const lists = new Map<string, Map<string, ListLine> | null>();
  for (const id of new Set(feeds.flatMap((f: any) => [f.siteId, f.fallbackSiteId]).filter((id: string) => usable(id)?.kind === "list"))) {
    const t = siteTally(id as string);
    try {
      const parsed = parseListSite((await fetcher(sites.get(id as string).url)).html);
      lists.set(id as string, parsed.size ? parsed : null);
      if (!parsed.size) t.error = "the list was read but had no prices in it";
    } catch (e: any) {
      lists.set(id as string, null);
      t.error = String(e?.message || e).slice(0, 160);
    }
  }

  const products = await db.product.findMany({
    where: { isVisible: true, brand: { in: feeds.flatMap((f: any) => [f.brand, f.brand.toUpperCase()]) } },
    select: { id: true, brand: true, productCode: true, sourceUrl: true },
  });
  const items = new Map<string, any>(
    (await db.brandPriceItem.findMany({ where: { productId: { in: products.map((p: any) => p.id) } } })).map((i: any) => [i.productId, i]),
  );
  const fresh = products.filter((p: any) => !items.has(p.id)).map((p: any) => ({ productId: p.id, brand: brandOf(p.brand) ?? p.brand, productCode: p.productCode || "" }));
  if (fresh.length) {
    await db.brandPriceItem.createMany({ data: fresh });
    for (const i of fresh) items.set(i.productId, { ...i, siteId: "", readAt: null });
  }

  const feedOf = new Map<string, any>(feeds.map((f: any) => [f.brand, f]));
  for (const f of feeds) run.brands[f.brand] = { products: 0, priced: 0, bySite: {}, noPrice: 0, left: 0, unread: 0 };
  const observations: any[] = [];
  const updates: [string, Record<string, any>][] = [];
  const LEFT = "left", UNREAD_LIST = "list_unread";
  // A site answering nothing but errors (Bosch's firewall, 26 Oct 2026) is
  // left alone after PAUSE_AFTER_FAILURES in a row: hammering it with the
  // remaining pages only prolongs the block. The rest wait for the next run.
  const failing = new Map<string, number>();

  const readFrom = async (siteId: string, p: any): Promise<Read> => {
    const site = sites.get(siteId);
    if (site.kind === "list") {
      const list = lists.get(siteId);
      if (!list) return { siteId, price: null, inStock: null, status: UNREAD_LIST, url: site.url, observed: false };
      const line = list.get(norm(p.productCode));
      return line ? { siteId, price: line.price, inStock: line.inStock, status: "ok", url: line.url, observed: true }
        : { siteId, price: null, inStock: null, status: "not_listed", url: site.url, observed: false };
    }
    if (Date.now() - started > deadlineMs || (failing.get(siteId) || 0) >= PAUSE_AFTER_FAILURES) return { siteId, price: null, inStock: null, status: LEFT, url: "", observed: false };
    const url = pageUrlFor(site.url, p.productCode || "", p.sourceUrl || "");
    const t = siteTally(siteId);
    t.read++;
    try {
      const r = readPagePrice((await fetcher(url)).html, p.productCode || "", url);
      failing.set(siteId, 0);
      return r.price !== null ? { siteId, price: r.price, inStock: r.inStock, status: "ok", url, observed: true } : { siteId, price: null, inStock: null, status: r.status, url, observed: true };
    } catch (e: any) {
      const n = (failing.get(siteId) || 0) + 1;
      failing.set(siteId, n);
      if (n >= PAUSE_AFTER_FAILURES && !t.error) t.error = `${PAUSE_AFTER_FAILURES} pages in a row could not be read (${String(e?.message || e).slice(0, 80)}) — the site may be blocking us; the rest wait for the next run`;
      return { siteId, price: null, inStock: null, status: "unread", url, observed: true };
    }
  };
  const save = (p: any, r: Read) => {
    if (!r.observed) return;
    if (r.price !== null) siteTally(r.siteId).priced++;
    observations.push({ productId: p.id, sourceId: r.siteId, price: r.price, inStock: r.inStock, deliveryCost: null, includesVat: true, sourceUrl: r.url,
      matchConfidence: 1, status: r.price !== null ? "ok" : "parse_failed", note: `Pricewire: ${sites.get(r.siteId).name}${r.price === null ? `, ${r.status.replace(/_/g, " ")}` : ""}` });
  };

  // Stalest first, so a run cut short by the deadline reaches the rest next time.
  const queue = [...products].sort((a: any, b: any) => (items.get(a.id)?.readAt ? new Date(items.get(a.id).readAt).getTime() : 0) - (items.get(b.id)?.readAt ? new Date(items.get(b.id).readAt).getTime() : 0));
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const p = queue[next++];
      const f = feedOf.get(brandOf(p.brand) ?? "");
      if (!f) continue;
      const t = run.brands[f.brand];
      t.products++;
      // Not reached, or not readable (blocked, slow, down): nothing is known
      // about the price, so the product keeps what it follows.
      const skip = (x: Read) => { if (x.status === LEFT) t.left++; else if (x.status === UNREAD_LIST || x.status === "unread") t.unread++; else return false; return true; };
      let r = await readFrom(f.siteId, p);
      save(p, r);
      if (skip(r)) continue;
      if (r.price === null && usable(f.fallbackSiteId)) {
        const b = await readFrom(f.fallbackSiteId, p);
        save(p, b);
        if (skip(b)) continue;
        if (b.price !== null || r.status === "not_listed") r = b;
      }
      if (r.price !== null) { t.priced++; t.bySite[r.siteId] = (t.bySite[r.siteId] || 0) + 1; } else t.noPrice++;
      updates.push([p.id, { siteId: r.price !== null ? r.siteId : "", price: r.price, inStock: r.inStock, status: r.status, url: r.url, readAt: new Date() }]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length || 1) }, worker));

  for (let i = 0; i < observations.length; i += 500) await db.priceObservation.createMany({ data: observations.slice(i, i + 500) });
  for (let i = 0; i < updates.length; i += 200) {
    await db.$transaction(updates.slice(i, i + 200).map(([productId, data]) => db.brandPriceItem.update({ where: { productId }, data })));
  }

  // What each list sells that we don't, and each site's and brand's last run.
  const ours = new Set(products.map((p: any) => norm(p.productCode)));
  for (const [id, list] of lists) {
    const t = siteTally(id);
    const data: Record<string, any> = { lastReadAt: new Date(), lastReadSummary: t.error ? `not read: ${t.error}` : `${list!.size} models listed, ${t.priced} of ours priced` };
    if (list) data.notInCatalogue = JSON.stringify([...list.values()].filter((l) => l.brand && !ours.has(norm(l.code)) && feedOf.has(l.brand))
      .map((l) => ({ code: l.code, brand: l.brand, title: l.title, price: l.price, section: l.section, url: l.url })));
    await db.priceSite.update({ where: { id }, data });
  }
  for (const [id, t] of Object.entries(run.sites)) {
    if (sites.get(id)?.kind === "page" && t.read) await db.priceSite.update({ where: { id }, data: { lastReadAt: new Date(), lastReadSummary: `${t.priced} of ${t.read} pages priced${t.error ? `; ${t.error}` : ""}`.slice(0, 300) } });
  }
  for (const f of feeds) {
    const t = run.brands[f.brand];
    const by = Object.entries(t.bySite).map(([id, n]) => `${n} from ${sites.get(id).name}`).join(", ") || "none priced";
    await db.brandPriceFeed.update({ where: { brand: f.brand }, data: { lastRunAt: new Date(),
      lastRunSummary: `${by}; ${t.noPrice} without a price${t.unread ? `; ${t.unread} pages not readable, kept as they were` : ""}${t.left ? `; ${t.left} left for the next run` : ""}`.slice(0, 300) } });
  }
  return run;
}

/* ----------------------------------------------------------- overview */

export type PendingChange = { productId: string; slug: string; brand: string; code: string; title: string; from: number | null; to: number; siteId: string };
export type SiteView = {
  id: string; name: string; kind: string; url: string; enabled: boolean; builtIn: boolean; automatic: boolean;
  lastReadAt: string | null; lastReadSummary: string; followers: number; usedBy: string[];
  notInCatalogue: { code: string; brand: string; title: string; price: number; section: string; url: string }[];
};
export type BrandView = {
  brand: FeedBrand; siteId: string; fallbackSiteId: string; enabled: boolean; lastRunAt: string | null; lastRunSummary: string;
  callForPrice: boolean; products: number; mapped: number; unmapped: number; showing: number; hiddenByCategory: number;
};
export type RunView = { at: string; by: string; summary: string };

/** Everything Admin → Pricewire shows. */
export async function pricewireOverview(db: any): Promise<{ sites: SiteView[]; brands: BrandView[]; pending: PendingChange[]; runs: RunView[] }> {
  await ensurePricewire(db);
  const [siteRows, feeds, items, brandRows, sources, poa, audits] = await Promise.all([
    db.priceSite.findMany({ orderBy: [{ builtIn: "desc" }, { createdAt: "asc" }] }),
    db.brandPriceFeed.findMany(),
    db.brandPriceItem.findMany({ include: { product: { select: { slug: true, title: true, priceNow: true, isVisible: true, category: true, subcategory: true } } } }),
    db.brand.findMany({ where: { name: { in: [...FEED_BRANDS] } }, select: { name: true, priceOnApplication: true } }).catch(() => []),
    db.priceSource.findMany({ select: { id: true, allowAutoApply: true, kind: true, enabled: true } }),
    poaNamesFromDb(db),
    db.adminAuditLog.findMany({ where: { action: { in: ["price-watch:maker-read", "pricewire:read"] } }, orderBy: { createdAt: "desc" }, take: 8, select: { createdAt: true, changedBy: true, newValue: true } }),
  ]);
  const live = items.filter((i: any) => i.product?.isVisible);
  const auto = new Map(sources.map((s: any) => [s.id, s.kind === "authorised" && s.enabled && s.allowAutoApply === true]));
  const sites: SiteView[] = siteRows.map((s: any) => {
    let notInCatalogue: SiteView["notInCatalogue"] = [];
    try { notInCatalogue = JSON.parse(s.notInCatalogue || "[]"); } catch { /* left empty */ }
    return {
      id: s.id, name: s.name, kind: s.kind, url: s.url, enabled: s.enabled, builtIn: s.builtIn, automatic: !!auto.get(s.id),
      lastReadAt: s.lastReadAt ? new Date(s.lastReadAt).toISOString() : null, lastReadSummary: s.lastReadSummary,
      followers: live.filter((i: any) => i.siteId === s.id).length,
      usedBy: feeds.filter((f: any) => f.enabled && (f.siteId === s.id || f.fallbackSiteId === s.id)).map((f: any) => f.brand),
      notInCatalogue,
    };
  });
  const pending: PendingChange[] = [];
  const brands: BrandView[] = FEED_BRANDS.map((brand) => {
    const f = feeds.find((x: any) => x.brand === brand);
    const mine = live.filter((i: any) => i.brand === brand);
    const callForPrice = !!brandRows.find((b: any) => b.name === brand)?.priceOnApplication;
    let hiddenByCategory = 0;
    for (const i of mine) {
      // A call-for-price brand's prices can never go on, so none of them is "waiting".
      if (!i.siteId || typeof i.price !== "number" || callForPrice) continue;
      if (isPoaProduct(poa, { category: i.product.category, subcategory: i.product.subcategory })) { hiddenByCategory++; continue; }
      if (!(typeof i.product.priceNow === "number" && Math.abs(i.product.priceNow - i.price) < 0.01)) {
        pending.push({ productId: i.productId, slug: i.product.slug, brand, code: i.productCode, title: i.product.title, from: i.product.priceNow ?? null, to: i.price, siteId: i.siteId });
      }
    }
    return {
      brand, siteId: f.siteId, fallbackSiteId: f.fallbackSiteId, enabled: f.enabled,
      lastRunAt: f.lastRunAt ? new Date(f.lastRunAt).toISOString() : null, lastRunSummary: f.lastRunSummary,
      callForPrice, products: mine.length, mapped: mine.filter((i: any) => i.siteId).length, unmapped: mine.filter((i: any) => !i.siteId).length,
      showing: mine.filter((i: any) => typeof i.product.priceNow === "number").length, hiddenByCategory,
    };
  });
  const runs: RunView[] = audits.map((a: any) => ({ at: new Date(a.createdAt).toISOString(), by: a.changedBy, summary: String((a.newValue as any)?.applied ?? (a.newValue as any)?.summary ?? "") }));
  return { sites, brands, pending: pending.sort((a, b) => a.brand.localeCompare(b.brand) || a.code.localeCompare(b.code)), runs };
}
