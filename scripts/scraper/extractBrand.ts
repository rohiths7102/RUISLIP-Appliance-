import * as cheerio from "cheerio";
import { BASE_URL } from "./config.js";
import { toSlug } from "./normalise.js";
import type { Brand } from "./schemas.js";

const abs = (h: string) => (h.startsWith("http") ? h : new URL(h, BASE_URL).toString());
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Extract brand name + logo from the "We stock the following brands" strip or /brands page. */
export function extractBrands(html: string): Brand[] {
  const $ = cheerio.load(html);
  const out = new Map<string, Brand>();
  $('a[href*="/brands/"], a[href*="/search?q="]').each((_, a) => {
    const href = $(a).attr("href") || "";
    const img = $(a).find("img").first();
    let name = "";
    const qm = href.match(/[?&]q=([^&]+)/); if (qm) name = decodeURIComponent(qm[1].replace(/\+/g, " "));
    const bm = href.match(/\/brands\/([^/?#]+)/); if (!name && bm) name = decodeURIComponent(bm[1]);
    if (!name) name = img.attr("alt") || "";
    name = clean(name);
    if (!name || name.length > 40 || /view all|shop/i.test(name)) return;
    const logo = img.attr("src") || img.attr("data-src") || "";
    const slug = toSlug(name);
    if (slug && !out.has(slug)) out.set(slug, { id: slug, name, slug, sourceUrl: abs(href), logo: logo ? abs(logo) : "", productCount: 0 });
  });
  return [...out.values()];
}
