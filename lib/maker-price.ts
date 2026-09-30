import { collectJsonLdProducts, parsePrice } from "@/lib/page-reader";

/**
 * The price Bosch or Neff itself shows for a model (bosch-home.co.uk,
 * neff-home.com). Their product pages come in three shapes (30 Sept 2026):
 *
 *   on sale in their shop   a structured Offer from seller "BSH" carries the
 *                           price, and the same price is on screen;
 *   "Currently unavailable" no BSH Offer at all — only the retailers' "where to
 *                           buy" list, without prices — but the price is still
 *                           on screen: data-testid="price-main-price", or on a
 *                           promotion "price-reduced-price" beside the struck-
 *                           through "Old price", which is never read;
 *   "no longer available"   no price anywhere: the maker has dropped the model.
 *
 * Until this reader, only the first shape counted, so 23 of Sachin's 68 best
 * sellers came back "no price" every night. The retailers' list is never a
 * price source (it is Currys' or AO's offer, not the maker's), and when the
 * structured and on-screen prices both exist they must agree, or the page is
 * not understood and nothing is read from it.
 */
export const MAKER_HOSTS = /(^|\.)(bosch-home\.co\.uk|neff-home\.com)$/i;

export type MakerRead =
  | { price: number; inStock: boolean; from: "offer" | "screen" }
  | { price: null; reason: "discontinued" | "no_price" | "prices_disagree" | "other_model" };

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const isMakerOffer = (o: any) => {
  if (!o || typeof o !== "object" || !/^Offer$/i.test(String(o["@type"] || ""))) return false;
  if (/^(BSH|Bosch|Neff)\b/i.test(String(o.seller?.name || ""))) return true;
  try { return MAKER_HOSTS.test(new URL(String(o.url || "")).hostname); } catch { return false; }
};

/** The first price in each element with this data-testid, in page order. */
function onScreen(html: string, testid: string): (number | null)[] {
  const re = new RegExp(`data-testid="${testid}"[^>]*>(?:\\s*<[^>]+>)*\\s*£\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, "g");
  return [...html.matchAll(re)].map((m) => parsePrice(m[1]));
}

/**
 * `code`: the model the page should be about. The makers answer ANY path
 * ending in a model code, so the page's own mpn/sku must name it too.
 */
export function readMakerPrice(rawHtml: string, code?: string): MakerRead {
  const products = collectJsonLdProducts(rawHtml);
  if (code && !products.some((p) => [p.mpn, p.sku, p.productID].some((v) => norm(v) === norm(code)))) return { price: null, reason: "other_model" };
  let offer: any = null;
  for (const p of products) {
    for (const o of Array.isArray(p.offers) ? p.offers : [p.offers]) {
      if (!offer && isMakerOffer(o) && (parsePrice(o.price) ?? 0) > 0) offer = o;
    }
  }
  const offerPrice = offer ? parsePrice(offer.price) : null;

  // The page inlines a <style> block between elements; without them each price
  // element's own markup sits directly around its "£".
  const html = rawHtml.replace(/<style[\s\S]*?<\/style>/gi, "");
  const reduced = onScreen(html, "price-reduced-price");
  const shown = reduced.length ? reduced : onScreen(html, "price-main-price");
  // The buy box is printed twice (page and sticky bar): those two must agree.
  const screenPrice = shown.length && (shown.length < 2 || shown[0] === shown[1]) ? shown[0] : null;
  if (shown.length && screenPrice === null) return { price: null, reason: "prices_disagree" };

  if (offerPrice !== null && screenPrice !== null && Math.abs(offerPrice - screenPrice) >= 0.01) return { price: null, reason: "prices_disagree" };
  if (offerPrice !== null && offerPrice > 0) return { price: offerPrice, inStock: /InStock/i.test(String(offer.availability || "")), from: "offer" };
  if (screenPrice !== null && screenPrice > 0) return { price: screenPrice, inStock: false, from: "screen" };
  return { price: null, reason: /Product is no longer available/i.test(html) ? "discontinued" : "no_price" };
}
