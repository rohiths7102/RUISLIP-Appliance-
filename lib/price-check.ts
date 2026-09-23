/**
 * "Check prices" for one product, on demand, from the admin.
 *
 * The owner clicks a product and sees what Euronics, the brand's own site and
 * any site he has added charge for THAT model, right now. Every read is saved as
 * a PriceObservation, so "Use this price" goes through the existing, fully
 * guarded /api/admin/price-watch/apply — this module never writes a price.
 *
 * Match discipline: a price only counts as this product's (confidence 1) when
 * the model code is on the page we read. Anything weaker is shown as "not
 * sure" (0.5), which the guards will not let the nightly job act on.
 *
 * AI is the last resort, not the method: only when a page has no machine-
 * readable price does Groq read the visible text, and that result is labelled
 * so nobody mistakes it for a structured read.
 */
import { fetchPage, collectJsonLdProducts, extract, LookupError, parsePrice } from "@/lib/page-reader";
import { callGemini } from "@/lib/chat/groq";

export type CheckStatus = "ok" | "no_offer" | "not_found" | "blocked" | "parse_failed";
export type CheckResult = {
  sourceId: string;
  label: string;
  kind: "euronics" | "brand" | "site";
  url: string;
  price: number | null;
  status: CheckStatus;
  matchConfidence: number;
  note: string;
  aiRead: boolean;
};

type Product = { id: string; productCode: string; brand: string; title: string; sourceUrl: string };

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
// The PATH only: a search URL carries the code in its query string, and must
// never pass for the product page itself.
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return ""; } };
const EURONICS = "https://www.euronics.co.uk";
const BRAND_HOSTS = /(^|\.)(bosch-home\.co\.uk|neff-home\.com)$/i;

/** One site we read for a price: Euronics, a brand site, or one the owner added. */
export type SiteSource = { id: string; label: string; host: string };

/** "https://www.ao.com/l/washing" or "ao.com" -> "www.ao.com" / "ao.com". */
export function siteHost(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const h = hostOf(withScheme);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : "";
}

/** Read one page and decide what it says about `code`. */
// `aiText`: only for added sites. Euronics and brand pages either carry a
// structured price or genuinely show none, so AI-reading their text is waste.
// The reading itself is Gemini's job: plain Gemini is free on our key and
// touches neither Groq allowance (the chatbot's, or the price check's search).
async function readProductPage(url: string, code: string, aiText = false): Promise<Omit<CheckResult, "sourceId" | "label" | "kind">> {
  let page;
  try { page = await fetchPage(url); }
  catch (e) {
    const msg = e instanceof LookupError ? e.message : "Could not read the page.";
    return { url, price: null, status: /blocked/i.test(msg) ? "blocked" : /404|doesn't exist/i.test(msg) ? "not_found" : "parse_failed", matchConfidence: 0, note: msg, aiRead: false };
  }
  const { html, finalUrl } = page;
  const want = norm(code);
  const ld = collectJsonLdProducts(html);
  const found = extract(html, finalUrl);

  // Is this page about OUR model? The code in the structured sku/mpn or the URL
  // is proof; the code merely somewhere in the page is good enough to say so.
  const strong = ld.some((p) => [p.sku, p.mpn, p.productID, p.model].some((v) => v && norm(String(v)).endsWith(want)))
    || norm(pathOf(finalUrl)).includes(want) || norm(found.productCode).endsWith(want);
  const weak = strong || norm(html).includes(want);
  if (!weak) return { url: finalUrl, price: null, status: "not_found", matchConfidence: 0, note: `This page doesn't mention ${code}.`, aiRead: false };
  const confidence = strong ? 1 : 0.5;

  if (ld.length && !ld.some((p) => p.offers)) {
    return { url: finalUrl, price: null, status: "no_offer", matchConfidence: confidence, note: "Listed, but not on sale here.", aiRead: false };
  }
  if (found.price !== null && found.price > 0) {
    return { url: finalUrl, price: Math.round(found.price * 100) / 100, status: "ok", matchConfidence: confidence, note: `Read from the page's ${found.source}.`, aiRead: false };
  }

  // Last resort: no machine-readable price. Ask Groq to read the visible text,
  // and say so. Never trusted as a match: capped at "not sure".
  if (aiText && process.env.GEMINI_API_KEY) {
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const at = Math.max(0, norm(text).indexOf(want) > -1 ? text.toUpperCase().indexOf(code.toUpperCase()) : 0);
    const excerpt = text.slice(Math.max(0, at - 1500), at + 2500);
    try {
      const reply = await callGemini([
        { role: "system", content: "You read UK retail product pages. Reply with JSON only: {\"price\": number|null}. The price is the CURRENT selling price in GBP including VAT for the product named — not a was-price, monthly finance figure, delivery charge, warranty, or another product's price. If unsure, return null." },
        { role: "user", content: `Product model: ${code}\nPage text:\n${excerpt}` },
      ], 15000);
      const n = parsePrice(JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] || "{}").price);
      if (n && n > 0) return { url: finalUrl, price: Math.round(n * 100) / 100, status: "ok", matchConfidence: Math.min(confidence, 0.5), note: "AI read the price from the page text — check it before using.", aiRead: true };
    } catch { /* fall through: say we could not find one */ }
  }
  return { url: finalUrl, price: null, status: "parse_failed", matchConfidence: confidence, note: "The page is about this model but shows no price we could read.", aiRead: false };
}

/** Euronics: the page we already hold, else their search by model code. */
async function checkEuronics(p: Product): Promise<CheckResult> {
  const base = { sourceId: "euronics", label: "Euronics", kind: "euronics" as const };
  let url = /(^|\.)euronics\.co\.uk$/i.test(hostOf(p.sourceUrl)) ? p.sourceUrl : "";
  if (!url) {
    try {
      const { html } = await fetchPage(`${EURONICS}/search?text=${encodeURIComponent(p.productCode)}`);
      const want = norm(p.productCode);
      const hit = [...html.matchAll(/href="(\/catalogue\/[^"]*\/p\/([A-Za-z0-9._-]+))"/g)].find((m) => norm(m[2]).endsWith(want));
      if (hit) url = EURONICS + hit[1];
    } catch { /* treated as not found below */ }
  }
  if (!url) return { ...base, url: `${EURONICS}/search?text=${encodeURIComponent(p.productCode)}`, price: null, status: "not_found", matchConfidence: 0, note: "Euronics doesn't list this model.", aiRead: false };
  return { ...base, ...(await readProductPage(url, p.productCode)) };
}

/** The brand's own site, where we already hold that page (Bosch, Neff: RRP). */
async function checkBrand(p: Product): Promise<CheckResult | null> {
  if (!BRAND_HOSTS.test(hostOf(p.sourceUrl))) return null;
  const r = await readProductPage(p.sourceUrl, p.productCode);
  return { sourceId: "manufacturer-rrp", label: `${p.brand} (brand site, RRP)`, kind: "brand", ...r };
}

type Finding = { url: string | null; price: number | null; busy?: "minute" | "day" };

const SEARCH_PROMPT = "Use web search to find the product page on the given website for exactly the given model code, and its current price there if the search shows it. Answer with exactly two lines:\nURL: <url or none>\nPRICE: <number in GBP, or unknown>";
const searchQuestion = (host: string, p: Product) => `Website: ${host}\nModel code: ${p.productCode}\nProduct: ${p.brand} ${p.title}`;

/** "URL: …\nPRICE: …" -> the page (only if on that site) and the price seen. */
function parseFinding(text: string, host: string): Finding {
  // Cut at anything that cannot be part of a URL: models append citation marks
  // straight onto the link ("…washing-machine【0†L1-L3】").
  // Also Markdown, which Gemini prefers: "**URL:** [https://…](https://…)".
  const url = (text.match(/URL:?\**\s*[[<(]?\s*(https:\/\/[^\s【】\[\]()<>"'`*]+)/i) || [])[1]?.replace(/[.,;:]+$/, "") || null;
  const price = parsePrice((text.match(/PRICE:?\**\s*£?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) || [])[1]);
  // The page must be on the site asked about — a search that wanders to another
  // retailer (or Google's own redirect links) is not an answer for this row.
  const bare = (h: string) => h.replace(/^www\./, "");
  const onSite = !!url && bare(hostOf(url)) === bare(host);
  return { url: onSite ? url : null, price: onSite && price && price > 0 ? price : null };
}

/**
 * Find this model on one site: Gemini with Google Search first, Groq's browser
 * search second. Both are real searches; neither is ever allowed to answer from
 * memory (no chat fallback here), because a remembered URL is exactly the guess
 * this avoids — and whatever they return is fetched and code-checked anyway.
 *
 * Gemini first: Google's index is the better one for UK retail, and its quota
 * is not the storefront chatbot's (which runs on Groq). Search from Gemini needs
 * billing enabled on the key; until then it refuses and Groq takes over.
 */
async function aiFindOnSite(host: string, p: Product): Promise<Finding & { why?: string }> {
  const g = await geminiFindOnSite(host, p);
  if (g.url) return g;
  const q = await groqFindOnSite(host, p);
  if (q.url || !q.busy) return q;
  return { ...q, why: q.busy === "day"
    ? "No AI search available: Gemini's Google Search needs billing enabled on the key, and Groq's free daily allowance is used up (it resets within 24 hours)."
    : "AI search is busy (Groq's per-minute limit) — try again in a minute." };
}

async function geminiFindOnSite(host: string, p: Product): Promise<Finding> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { url: null, price: null };
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SEARCH_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: searchQuestion(host, p) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    }),
  }).catch(() => null);
  if (!r || !r.ok) return { url: null, price: null };
  const j: any = await r.json().catch(() => ({}));
  const text = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x?.text || "").join("");
  return parseFinding(text, host);
}

async function groqFindOnSite(host: string, p: Product): Promise<Finding> {
  // Its own Groq account (GROQ_PRICE_CHECK_API_KEY): Groq limits per account,
  // and searches are ~5–13k tokens each, so on the chatbot's key a busy day of
  // price checks took the storefront assistant's allowance with it.
  const key = process.env.GROQ_PRICE_CHECK_API_KEY || process.env.GROQ_API_KEY;
  if (!key) return { url: null, price: null };
  // Groq allows ~8k tokens a minute on this key and one search spends ~5k, as a
  // bucket that refills continuously. So a refusal usually clears in seconds:
  // wait what Groq says (capped at 12s) and try once more before saying "busy".
  // The free tier also caps tokens per DAY (200k, ~15-30 searches on this
  // account). That one does not clear in seconds, so it is reported as such and
  // never waited on.
  const perDay = async (res: Response) => /per day|TPD/i.test(await res.clone().text().catch(() => ""));
  let r = await askGroqSearch(key, host, p);
  if (r && r.status === 429 && !(await perDay(r))) {
    const wait = Math.min(12, Number(r.headers.get("retry-after")) || parseFloat(r.headers.get("x-ratelimit-reset-tokens") || "") || 8);
    await new Promise((res) => setTimeout(res, wait * 1000));
    r = await askGroqSearch(key, host, p);
  }
  if (!r) return { url: null, price: null };
  if (r.status === 429) return { url: null, price: null, busy: (await perDay(r)) ? "day" : "minute" };
  if (!r.ok) return { url: null, price: null };
  return parseFinding(String((await r.json())?.choices?.[0]?.message?.content || ""), host);
}

function askGroqSearch(key: string, host: string, p: Product): Promise<Response | null> {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      tools: [{ type: "browser_search" }],
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: SEARCH_PROMPT },
        { role: "user", content: searchQuestion(host, p) },
      ],
    }),
  }).catch(() => null);
}

/**
 * A site the owner added. Found once by AI web search, then remembered: the
 * page it found is kept on the observation, so the next check of this product
 * reads that page straight away and costs no AI at all.
 */
async function checkSite(src: SiteSource, p: Product, knownUrl: string): Promise<CheckResult> {
  const base = { sourceId: src.id, label: src.label, kind: "site" as const };
  let url = knownUrl;
  let aiPrice: number | null = null;
  if (!url) {
    const found = await aiFindOnSite(src.host, p);
    if (found.why) return { ...base, url: `https://${src.host}`, price: null, status: "parse_failed", matchConfidence: 0, aiRead: false, note: found.why };
    if (!found.url) return { ...base, url: `https://${src.host}`, price: null, status: "not_found", matchConfidence: 0, note: `AI search couldn't find ${p.productCode} on this site.`, aiRead: false };
    url = found.url;
    aiPrice = found.price;
  }
  const read = await readProductPage(url, p.productCode, true);
  // A price we read and matched ourselves beats anything the search reported.
  if (read.status === "ok" && !read.aiRead) return { ...base, ...read };
  if (aiPrice !== null && read.status !== "no_offer") {
    return { ...base, ...read, url, price: aiPrice, status: "ok", matchConfidence: 0.5, aiRead: true,
      note: read.status === "blocked" ? "Site blocks automated reading; price from AI web search — unverified, open the link to confirm."
        : "Price from AI web search — unverified, open the link to confirm." };
  }
  return { ...base, ...read };
}

/**
 * Everything for one product. `known` = page already found per added site.
 * Euronics and the brand site run alongside the added sites; the added sites
 * run ONE AT A TIME, because each first-time AI search is ~6k tokens and Groq
 * caps tokens per minute — in parallel, the second search is simply refused.
 */
export async function checkPrices(p: Product, sites: SiteSource[], known: Record<string, string> = {}): Promise<CheckResult[]> {
  const addedSites = (async () => {
    const out: CheckResult[] = [];
    for (const s of sites) out.push(await checkSite(s, p, known[s.id] || "").catch(() => ({
      sourceId: s.id, label: s.label, kind: "site" as const, url: `https://${s.host}`, price: null,
      status: "parse_failed" as const, matchConfidence: 0, note: "Check failed — try again.", aiRead: false,
    })));
    return out;
  })();
  const [eur, brand, rest] = await Promise.allSettled([checkEuronics(p), checkBrand(p), addedSites]);
  return [
    ...(eur.status === "fulfilled" ? [eur.value] : []),
    ...(brand.status === "fulfilled" && brand.value ? [brand.value] : []),
    ...(rest.status === "fulfilled" ? rest.value : []),
  ];
}
