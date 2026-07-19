import * as cheerio from "cheerio";
import {
  BASE_URL, ALLOWED_HOSTS, DISALLOW_PREFIXES, SKIP_QUERY_KEYS, PRODUCT_URL_RE,
} from "./config.js";
import { fetchText } from "./http.js";
import { classifyPage } from "./extractPage.js";

export interface CrawlItem { url: string; type: string; }

function normaliseUrl(raw: string, from: string): string | null {
  let u: URL;
  try { u = new URL(raw, from); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (!ALLOWED_HOSTS.has(u.host)) return null;                       // internal only
  u.hash = "";
  if (DISALLOW_PREFIXES.some((p) => u.pathname.toLowerCase().startsWith(p))) return null;
  // Drop tracking / filter query params; if any facet key remains, skip the URL entirely.
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_|^gclid$|^fbclid$/i.test(key)) u.searchParams.delete(key);
  }
  if ([...u.searchParams.keys()].some((k) => SKIP_QUERY_KEYS.includes(k.toLowerCase()))) return null;
  u.search = [...u.searchParams.keys()].length ? u.search : "";
  // Canonicalise trailing slash (except root).
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** Pull URLs from /sitemap.xml (and nested sitemaps) if present — the cleanest discovery source. */
export async function fromSitemap(): Promise<string[]> {
  const urls = new Set<string>();
  const queue = [`${BASE_URL}/sitemap.xml`, `${BASE_URL}/sitemap_index.xml`];
  for (const sm of queue) {
    try {
      const xml = await fetchText(sm);
      const $ = cheerio.load(xml, { xmlMode: true });
      $("loc").each((_, el) => {
        const loc = $(el).text().trim();
        if (loc.endsWith(".xml")) queue.push(loc);
        else { const n = normaliseUrl(loc, BASE_URL); if (n) urls.add(n); }
      });
    } catch { /* no sitemap — fall back to link discovery */ }
  }
  return [...urls];
}

/**
 * Breadth-first crawl starting from BASE_URL. Honours robots via config
 * (host allowlist, disallowed prefixes, facet-query skipping) and http.ts crawl-delay.
 * @param opts.max  hard cap on pages fetched (safety); omit for full crawl.
 */
export async function crawl(opts: { max?: number; onError?: (u: string, e: string) => void } = {}): Promise<CrawlItem[]> {
  const seen = new Set<string>();
  const found = new Map<string, CrawlItem>();
  const seeds = await fromSitemap();
  const queue: string[] = [BASE_URL, ...seeds];

  while (queue.length) {
    if (opts.max && seen.size >= opts.max) break;
    const url = queue.shift()!;
    const norm = normaliseUrl(url, BASE_URL);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const type = classifyPage(new URL(norm).pathname);
    found.set(norm, { url: norm, type });

    // Only spider hub pages for more links; product pages are leaves.
    if (type === "product") continue;
    try {
      const html = await fetchText(norm);
      const $ = cheerio.load(html);
      $("a[href]").each((_, a) => {
        const n = normaliseUrl($(a).attr("href") || "", norm);
        if (n && !seen.has(n)) queue.push(n);
      });
    } catch (e) {
      opts.onError?.(norm, String(e));
    }
  }
  return [...found.values()];
}

export const isProductUrl = (u: string) => PRODUCT_URL_RE.test(u);
