import * as cheerio from "cheerio";
import { toSlug } from "./normalise.js";
import type { Page } from "./schemas.js";

const text = (s: string) => s.replace(/\s+/g, " ").trim();

/** Classify a URL into a page type using its path. */
export function classifyPage(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p === "/" || p === "") return "home";
  if (/\/p-\d+\/?$/.test(p)) return "product";
  if (p.startsWith("/brands/")) return "brand";
  if (p.startsWith("/about")) return "about";
  if (p.includes("delivery")) return "delivery";
  if (p.includes("contact")) return "contact";
  if (p.includes("service-and-support") || p.includes("support")) return "service";
  if (p.includes("news") || p.includes("events") || p.includes("promotions")) return "news";
  if (p.includes("privacy") || p.includes("terms") || p.includes("cookies")) return "legal";
  // Category paths are short and have no /p- segment.
  if (p.split("/").filter(Boolean).length <= 2) return "category";
  return "page";
}

export function extractPage(html: string, sourceUrl: string): Page {
  const $ = cheerio.load(html);
  const pathname = new URL(sourceUrl).pathname;
  const headings: string[] = [];
  $("h1,h2,h3").each((_, h) => { const t = text($(h).text()); if (t) headings.push(t); });
  const main = $("main, #content, .content, .cms-content").first();
  const container = main.length ? main : $("body");
  const contentHtml = (container.html() || "").trim();
  return {
    id: toSlug(pathname || "home"),
    type: classifyPage(pathname),
    title: text($("h1").first().text()) || text($("title").text()),
    oldUrl: pathname,
    newSlug: pathname,
    sourceUrl,
    headings,
    contentHtml,
    contentText: text(container.text()).slice(0, 8000),
    seoTitle: text($("title").text()),
    seoDescription: text($('meta[name="description"]').attr("content") || ""),
    scrapedAt: new Date().toISOString(),
  };
}
