import * as cheerio from "cheerio";
import { BASE_URL, PRODUCT_URL_RE } from "./config.js";
import { toSlug } from "./normalise.js";
import type { Category } from "./schemas.js";

const abs = (href: string) => (href.startsWith("http") ? href : new URL(href, BASE_URL).toString());
const text = (s: string) => s.replace(/\s+/g, " ").trim();

export function extractCategory(html: string, sourceUrl: string, parent = ""): Category {
  const $ = cheerio.load(html);
  const name = text($("h1").first().text()) || text($('meta[property="og:title"]').attr("content") || "");
  const slug = new URL(sourceUrl).pathname;
  const productCount = $(`a[href*="/p-"]`).filter((_, a) => PRODUCT_URL_RE.test($(a).attr("href") || "")).length;
  const description = text($(".category-description, .cms-content p").first().text());
  return {
    id: toSlug(name || slug),
    name, slug,
    sourceUrl,
    parentCategory: parent,
    children: [],
    description,
    productCount,
    image: abs($(".category-hero img, .banner img").first().attr("src") || ""),
    seoTitle: text($("title").text()) || name,
    seoDescription: text($('meta[name="description"]').attr("content") || ""),
  };
}
