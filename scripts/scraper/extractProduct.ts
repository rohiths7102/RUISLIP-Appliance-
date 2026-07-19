import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { BASE_URL, PRODUCT_URL_RE } from "./config.js";
import {
  parsePrice, cleanWarranty, newProductSlug, normaliseAvailability,
} from "./normalise.js";
import type { Product } from "./schemas.js";

const abs = (href: string) => (href.startsWith("http") ? href : new URL(href, BASE_URL).toString());
const text = (s: string) => s.replace(/\s+/g, " ").trim();

/** Try JSON-LD Product blocks first — most reliable when present. */
function readJsonLd($: CheerioAPI): any | null {
  let found: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const node of arr) {
        const t = node?.["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) found = node;
      }
    } catch { /* ignore malformed ld+json */ }
  });
  return found;
}

/**
 * Extract a full product from a detail page.
 * NOTE: DOM-class selectors below are best-effort. Run `npm run scrape:sample --
 * --debug` to dump a page's HTML and confirm/tune the fallback selectors.
 */
export function extractProduct(html: string, sourceUrl: string): Product {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const ld = readJsonLd($);
  const idMatch = sourceUrl.match(PRODUCT_URL_RE);
  const id = idMatch ? idMatch[1] : sourceUrl;

  const title = text(ld?.name || $("h1").first().text() || $('meta[property="og:title"]').attr("content") || "");
  const productCode = text(
    ld?.mtn || ld?.sku || ld?.mpn ||
    $('[itemprop="sku"], [itemprop="mpn"], .product-code, .productCode').first().text() ||
    (title.match(/\b([A-Z0-9][A-Z0-9\/\-. ]{3,})\b/)?.[1] ?? "")
  );

  // Prices: prefer JSON-LD offers, else scan for "Our price" / "Was".
  const bodyText = $("body").text();
  const priceNow =
    parsePrice(ld?.offers?.price) ??
    parsePrice(bodyText.match(/Our price\s*£?\s*([0-9.,]+)/i)?.[1]) ??
    parsePrice($('.price, .our-price, [itemprop="price"]').first().text());
  const priceWas = parsePrice(bodyText.match(/Was\s*£?\s*([0-9.,]+)/i)?.[1]);
  const saving = parsePrice(bodyText.match(/Save\s*£?\s*([0-9.,]+)/i)?.[1]);

  const availabilityRaw = text(
    ld?.offers?.availability?.replace(/https?:\/\/schema.org\//, "") ||
    $(".availability, .stock, .stock-status").first().text() || ""
  );

  const warranty = cleanWarranty(
    $(".warranty, .guarantee").first().text() ||
    bodyText.match(/(\d+\s*Year[^<\n]{0,60}?(?:Warranty|Guarantee|Parts))/i)?.[1] || ""
  );

  const descriptionHtml = ($('[itemprop="description"], .product-description, #description').first().html() || ld?.description || "").trim();
  const descriptionText = text(cheerio.load(`<div>${descriptionHtml}</div>`)("div").text());
  const shortDescription = text(($('meta[name="description"]').attr("content") || descriptionText).slice(0, 220));

  // Specifications: any table of label/value rows.
  const specifications: { label: string; value: string }[] = [];
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("th,td");
    if (cells.length >= 2) {
      const label = text($(cells[0]).text());
      const value = text($(cells[1]).text());
      if (label && value && label.toLowerCase() !== value.toLowerCase()) specifications.push({ label, value });
    }
  });

  // Gallery: product images on the client CDN.
  const gallery = new Set<string>();
  $('img[src*="/images/products/"], img[src*="rackcdn.com"], .product-gallery img, .gallery img').each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src");
    if (src) gallery.add(abs(src));
  });
  const image = ld?.image?.[0] || ld?.image || [...gallery][0] || "";

  // Breadcrumbs
  const breadcrumbs: string[] = [];
  $('nav.breadcrumb a, .breadcrumbs a, [itemtype*="BreadcrumbList"] [itemprop="name"]').each((_, a) => {
    const t = text($(a).text());
    if (t) breadcrumbs.push(t);
  });

  // Related products (link by code later in normalise.linkRelatedByCode)
  const relatedProducts: Product["relatedProducts"] = [];
  $('.related a, .related-products a, .cross-sell a').each((_, a) => {
    const href = $(a).attr("href") || "";
    if (PRODUCT_URL_RE.test(href)) {
      relatedProducts.push({ productCode: "", title: text($(a).text()), url: abs(href), price: null });
    }
  });

  const energyLabelUrl =
    $('a[href*="energy"][href$=".pdf"], a[href*="energy-label"], img[src*="energy"]').first().attr("href") ||
    $('img[src*="energy"]').first().attr("src") || "";

  const brand = text(ld?.brand?.name || ld?.brand || title.split(" ")[0] || "");

  return {
    id, sourceUrl, oldUrl: new URL(sourceUrl).pathname,
    newSlug: newProductSlug(title, productCode),
    title, brand, productCode,
    category: breadcrumbs[1] || "", subcategory: breadcrumbs[2] || "",
    breadcrumbs,
    priceNow: priceNow ?? null, priceWas: priceWas ?? null, saving: saving ?? null,
    currency: "GBP",
    availability: availabilityRaw,
    availabilityNormalised: normaliseAvailability(availabilityRaw),
    warranty, shortDescription, descriptionHtml, descriptionText,
    specifications, features: [],
    energyLabelUrl: energyLabelUrl ? abs(energyLabelUrl) : "",
    image: image ? abs(image) : "", gallery: [...gallery],
    relatedProducts, services: [], deliveryNotes: "",
    seoTitle: text($("title").text()) || title,
    seoDescription: shortDescription,
    meta: {}, scrapedAt: now,
  };
}

/** Parse product cards from a listing/category/home page. Returns partial products + their URLs. */
export function extractProductCards(html: string, pageUrl: string): Partial<Product>[] {
  const $ = cheerio.load(html);
  const cards = new Map<string, Partial<Product>>();
  $(`a[href*="/p-"]`).each((_, a) => {
    const href = $(a).attr("href") || "";
    if (!PRODUCT_URL_RE.test(href)) return;
    const url = abs(href.split("?")[0]);
    if (cards.has(url)) return;
    // Climb to the enclosing card so we can read siblings (code, price, warranty).
    const card = $(a).closest("li,article,.product,.product-card,.product-item,div");
    const blockText = text(card.text());
    const img = card.find("img").first().attr("src") || $(a).find("img").attr("src") || "";
    const title = text(card.find("h2,h3,h4").first().text()) || $(a).find("img").attr("alt") || "";
    const code = (blockText.match(/\b([A-Z0-9][A-Z0-9\/\-. ]{3,})\b/)?.[1] || "").trim();
    cards.set(url, {
      sourceUrl: url,
      oldUrl: new URL(url).pathname,
      title: title.replace(/\s+\d+\s*Year.*$/i, "").trim(),
      productCode: code,
      image: img ? abs(img) : "",
      priceNow: parsePrice(blockText.match(/Our price\s*£?\s*([0-9.,]+)/i)?.[1]),
      priceWas: parsePrice(blockText.match(/Was\s*£?\s*([0-9.,]+)/i)?.[1]),
      saving: parsePrice(blockText.match(/Save\s*£?\s*([0-9.,]+)/i)?.[1]),
      warranty: cleanWarranty(blockText.match(/(\d+\s*Year[^\n]{0,50}?(?:Warranty|Guarantee|Parts))/i)?.[1] || ""),
    });
  });
  return [...cards.values()];
}
