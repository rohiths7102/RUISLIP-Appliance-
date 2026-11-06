import { fetchPage, collectJsonLdProducts, parsePrice } from "@/lib/page-reader";

/**
 * Pricewire mapping: finding a product on any shop's site, and reading a price
 * from a site that has no structured product data.
 *
 *   discover      a "search" site's own search (its address has {q}) is asked
 *                 for the model; the result pages are scored — the model code
 *                 or EAN in the page's product data is certain ("auto"), the
 *                 code in the page text nearly so, a matching title only
 *                 "review" (the owner confirms). The page found is remembered
 *                 (ProductSiteLink) so the next read goes straight to it.
 *   point & click the owner pastes one product page; every element showing a £
 *                 price is listed; the one they pick becomes the site's
 *                 price location (PriceSite.priceSelector).
 *   robots.txt    sites the owner adds are read only where their robots.txt
 *                 allows it.
 *   schedule      how soon a product's page is worth reading again.
 */

export type Fetcher = (url: string, known?: { etag?: string; lastModified?: string }) => Promise<{ html: string; notModified?: boolean; etag?: string; lastModified?: string }>;

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const stripTags = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&pound;|&#163;|&#xa3;/gi, "£").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1));

/* ------------------------------------------------------------ robots.txt */

export type RobotsRules = { allow: string[]; disallow: string[] };
const BOT = "jyotsnaelectricalbot";

/** Our group in a robots.txt (our own name if listed, else "*"). */
export function parseRobots(txt: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && val) cur.allow.push(val);
    if (key === "disallow" && val) cur.disallow.push(val);
  }
  const mine = groups.find((g) => g.agents.some((a) => a && BOT.includes(a.replace(/\*$/, "")) && a !== "*")) || groups.find((g) => g.agents.includes("*"));
  return { allow: mine?.allow ?? [], disallow: mine?.disallow ?? [] };
}

const ruleMatch = (rule: string, path: string) => {
  const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
};
/** The longest matching rule wins; Allow wins a tie (Google's reading of the standard). */
export function robotsAllowsPath(rules: RobotsRules, path: string): boolean {
  let best = -1, allowed = true;
  for (const r of rules.allow) if (ruleMatch(r, path) && r.length >= best) { best = r.length; allowed = true; }
  for (const r of rules.disallow) if (ruleMatch(r, path) && r.length > best) { best = r.length; allowed = false; }
  return allowed;
}

const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
/** Whether robots.txt lets us read this URL. A site with no robots.txt (or one we can't read) sets no rules. */
export async function robotsAllows(url: string, fetcher: Fetcher = fetchPage): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const key = u.origin;
  let hit = robotsCache.get(key);
  if (!hit || Date.now() - hit.at > 6 * 3600_000) {
    let rules: RobotsRules = { allow: [], disallow: [] };
    try { rules = parseRobots((await fetcher(`${u.origin}/robots.txt`)).html || ""); } catch { /* none, or unreadable: no rules */ }
    hit = { at: Date.now(), rules };
    robotsCache.set(key, hit);
  }
  return robotsAllowsPath(hit.rules, u.pathname + u.search);
}

/* ------------------------------------------------------- point and click */

export type PriceCandidate = { selector: string; price: number; text: string; context: string };

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};
// Class names a site generates per build or per page (hashes, ids) can't be relied on next week.
const stableClass = (c: string) => c.length > 1 && c.length < 40 && !/\d{3,}|^(?=[a-z]*\d)[a-z0-9]{6,}$|^css-|^sc-|^jsx-/i.test(c);

/** A selector for an element: its id, an itemprop, or up to two stable class names. */
export function selectorFor(tag: string, attrs: string): string {
  const t = tag.toLowerCase();
  const id = attr(attrs, "id");
  if (id && stableClass(id)) return `${t}#${id}`;
  const prop = attr(attrs, "itemprop");
  if (prop) return `${t}[itemprop=${prop}]`;
  const cls = attr(attrs, "class").split(/\s+/).filter(stableClass).slice(0, 2);
  return cls.length ? `${t}.${cls.join(".")}` : t;
}

const PRICE_IN_TEXT = /£\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/;
const BARE_MONEY = /^\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})\s*$/;
/** An element that says it is a price: "price" in its id/class, itemprop=price, or a data-price value. */
const pricey = (attrs: string) => /price/i.test(`${attr(attrs, "id")} ${attr(attrs, "class")} ${attr(attrs, "itemprop")}`) || !!attr(attrs, "data-price");

/** Every element on a page that shows one £ price, with a selector and the words before it. */
export function priceCandidates(html: string): PriceCandidate[] {
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/&pound;|&#163;|&#xa3;/gi, "£").replace(/&nbsp;/g, " ");
  const out: PriceCandidate[] = [];
  const seen = new Set<string>();
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>((?:(?!<\/?\1\b)[\s\S]){0,300}?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) && out.length < 60) {
    // Carry on just inside this element, so a price nested in a wrapper is offered too.
    re.lastIndex = m.index + m[0].indexOf(">") + 1;
    const inner = stripTags(m[3]);
    if (inner.length > 60) continue;
    // "£399.00" in the element, or a bare "399.00" in an element that is plainly a price
    // (<span id="productprice" data-price="399.00">399.00</span>, with the £ printed outside it).
    const before = stripTags(clean.slice(Math.max(0, m.index - 40), m.index));
    const pm = inner.match(PRICE_IN_TEXT) || ((pricey(m[2]) || /£\s*$/.test(before)) ? inner.match(BARE_MONEY) : null);
    if (!pm) continue;
    const price = parsePrice(pm[1]);
    if (price === null || price <= 0) continue;
    const selector = selectorFor(m[1], m[2]);
    const key = `${selector}|${price}`;
    if (seen.has(key) || selector === m[1].toLowerCase()) continue; // a bare <span> can't be found again
    seen.add(key);
    out.push({ selector, price, text: inner, context: stripTags(clean.slice(Math.max(0, m.index - 300), m.index)).slice(-70), main: pricey(m[2]) } as PriceCandidate & { main: boolean });
  }
  // Elements that call themselves a price first: the shop's own price is far likelier there than in a "price match" box.
  return (out as (PriceCandidate & { main: boolean })[]).sort((a, b) => Number(b.main) - Number(a.main)).map(({ main: _main, ...c }) => c);
}

/** The price shown in the first element matching a selector made by selectorFor. */
export function readBySelector(html: string, selector: string): number | null {
  const s = selector.match(/^([a-z][a-z0-9]*)(?:#([^.[\s]+)|\[itemprop=([^\]]+)\]|((?:\.[^.\s[]+)+))?$/i);
  if (!s) return null;
  const [, tag, id, prop, classes] = s;
  const want = classes ? classes.slice(1).split(".") : [];
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/&pound;|&#163;|&#xa3;/gi, "£").replace(/&nbsp;/g, " ");
  const re = new RegExp(`<${tag}\\b([^>]*)>((?:(?!<\\/?${tag}\\b)[\\s\\S]){0,300}?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const a = m[1];
    if (id && attr(a, "id") !== id) continue;
    if (prop && attr(a, "itemprop") !== prop) continue;
    if (want.length) { const have = new Set(attr(a, "class").split(/\s+/)); if (!want.every((c) => have.has(c))) continue; }
    const content = attr(a, "content") || attr(a, "data-price");
    const text = stripTags(m[2]);
    const pm = (content ? `£${content}` : text).match(PRICE_IN_TEXT) || text.match(BARE_MONEY);
    const price = pm ? parsePrice(pm[1]) : null;
    if (price !== null && price > 0) return price;
  }
  return null;
}

/** Whether a page is about this model: its code in the page text (long codes only — short ones hide inside others). */
export const pageNamesModel = (html: string, code: string) => norm(code).length >= 5 && norm(stripTags(html)).includes(norm(code));

/* --------------------------------------------------------------- discovery */

export type MatchProduct = { code: string; gtin?: string | null; title: string; brand: string };
export type PageScore = { confidence: number; matchedBy: "code" | "ean" | "code_on_page" | "title" | "" };

/** How sure we are that a page is this product. */
export function scorePage(html: string, p: MatchProduct): PageScore {
  const products = collectJsonLdProducts(html);
  if (products.some((x) => [x.mpn, x.sku, x.productID, x.model].some((v) => v && norm(v) === norm(p.code)))) return { confidence: 1, matchedBy: "code" };
  if (p.gtin && products.some((x) => [x.gtin, x.gtin13, x.gtin12, x.gtin14, x.gtin8].some((v) => v && String(v).replace(/\D/g, "") === p.gtin))) return { confidence: 1, matchedBy: "ean" };
  if (norm(p.code).length >= 6 && pageNamesModel(html, p.code)) return { confidence: 0.9, matchedBy: "code_on_page" };
  const title = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || products[0]?.name || "";
  const a = words(stripTags(title)), b = words(p.title);
  const shared = [...b].filter((w) => a.has(w)).length;
  const jaccard = shared / Math.max(1, new Set([...a, ...b]).size);
  if (jaccard >= 0.5 && a.has(p.brand.toLowerCase())) return { confidence: 0.6, matchedBy: "title" };
  return { confidence: 0, matchedBy: "" };
}

/** Product links on a search results page, best first: those naming the model, then those sharing the title's words. */
export function searchResultLinks(html: string, pageUrl: string, p: MatchProduct, max = 4): string[] {
  const base = host(pageUrl);
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1], pageUrl).toString(); } catch { continue; }
    if (host(url) !== base || seen.has(url) || /\/(cart|basket|login|account|search|wishlist|compare)\b|[?&](q|search|page)=/i.test(url)) continue;
    seen.add(url);
    const text = stripTags(m[2]);
    const named = norm(url).includes(norm(p.code)) || norm(text).includes(norm(p.code));
    const overlap = [...words(text)].filter((w) => words(p.title).has(w)).length;
    const score = (named ? 10 : 0) + overlap;
    if (named || overlap >= 3) scored.push({ url, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.url);
}

/** A product a search site didn't have is looked for again after this long (it may be stocked by then). */
export const NOT_FOUND_RETRY_DAYS = 30;

export type Discovery = { found: true; url: string; confidence: number; matchedBy: PageScore["matchedBy"]; status: "auto" | "review" } | { found: false; url: ""; reason: string };

/** Find one product on a search site. Polite: robots.txt, at most 4 result pages, stops at the first certain match. */
export async function discover(searchUrl: string, p: MatchProduct, fetcher: Fetcher = fetchPage): Promise<Discovery> {
  const url = searchUrl.replace(/\{q\}/gi, encodeURIComponent(p.code));
  if (!(await robotsAllows(url, fetcher))) return { found: false, url: "", reason: "robots.txt asks us not to use this site's search" };
  let results: string;
  try { results = (await fetcher(url)).html; } catch (e: any) { return { found: false, url: "", reason: `search didn't load: ${String(e?.message || e).slice(0, 80)}` }; }
  // Some sites jump straight to the product when the search is an exact model number. A results page
  // merely mentioning the code doesn't count: only the page's own product data naming it does.
  const direct = scorePage(results, p);
  if (direct.confidence === 1) return { found: true, url, confidence: direct.confidence, matchedBy: direct.matchedBy, status: "auto" };
  let best: { url: string; s: PageScore } | null = null;
  for (const link of searchResultLinks(results, url, p)) {
    if (!(await robotsAllows(link, fetcher))) continue;
    let html: string;
    try { html = (await fetcher(link)).html; } catch { continue; }
    const s = scorePage(html, p);
    if (!best || s.confidence > best.s.confidence) best = { url: link, s };
    if (s.confidence >= 0.9) break;
  }
  if (!best || best.s.confidence < 0.6) return { found: false, url: "", reason: "not found on the site" };
  return { found: true, url: best.url, confidence: best.s.confidence, matchedBy: best.s.matchedBy, status: best.s.confidence >= 0.9 ? "auto" : "review" };
}

/* ---------------------------------------------------------------- schedule */

const DAY = 86_400_000;
/**
 * When a product's page is next worth reading: tomorrow when its price just
 * moved, moved in the last fortnight or moves often; in a week when the site
 * has no price for it; otherwise in three days. The morning run reads only
 * pages that are due, so the sites see a fraction of the traffic.
 */
export function nextCheckAt(now: Date, s: { changed: boolean; priced: boolean; priceChanges: number; lastChangeAt: Date | null }): Date {
  const recent = s.lastChangeAt && now.getTime() - s.lastChangeAt.getTime() < 14 * DAY;
  const days = s.changed || recent || s.priceChanges >= 3 ? 1 : !s.priced ? 7 : 3;
  // A few hours early, so tomorrow's 05:00 run counts a page read at 05:30 today as due.
  return new Date(now.getTime() + days * DAY - 4 * 3600_000);
}
