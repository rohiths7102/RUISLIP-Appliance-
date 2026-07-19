/**
 * Central config for the kitchen-appliances.co.uk content migration scraper.
 * Client-owned site. Phone-first business model (no ecommerce in the new frontend).
 *
 * Compliance: values below are tuned to the site's live robots.txt (observed).
 * Do NOT lower CRAWL_DELAY_MS or ignore DISALLOW rules without the client's
 * written confirmation that they own/permit it.
 */

export const BASE_URL = "https://www.kitchen-appliances.co.uk";

export const ALLOWED_HOSTS = new Set([
  "www.kitchen-appliances.co.uk",
  "kitchen-appliances.co.uk",
]);

/** Image CDNs used by the client's live site (safe to fetch product/brand media from). */
export const ALLOWED_MEDIA_HOSTS = [
  "ssl.cf3.rackcdn.com",       // rackspace CDN (products, brands, promos, site-settings)
  "www.kitchen-appliances.co.uk",
];

/** Identify the crawler honestly. Put a real contact address here before running. */
export const USER_AGENT =
  "JyotsnaMigrationBot/1.0 (+content migration for site owner; contact: hello@yourdomain.example)";

/** robots.txt says `Crawl-delay: 20`. Respect it. p-limit is therefore effectively serial. */
export const CRAWL_DELAY_MS = 20_000;
export const CONCURRENCY = 1;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 3;

/** Paths disallowed in robots.txt for User-Agent: *  */
export const DISALLOW_PREFIXES = ["/dashboard", "/basket", "/my-account", "/checkout"];

/**
 * Filter/facet query keys that create near-infinite URL permutations.
 * (Googlebot is disallowed from these in robots.txt.) We skip any URL carrying them.
 */
export const SKIP_QUERY_KEYS = [
  "price", "energy-efficiency-class", "height", "width", "depth", "color",
  "stock", "builtin-or-freestanding", "smart-tv", "screen-size", "technology",
  "fuel-type", "product-line", "microwave-type", "number-of-slots", "type",
  "page", "sort", "q",
];

/** A product detail URL ends in `/p-<digits>`  e.g. /bosch-.../p-7320 */
export const PRODUCT_URL_RE = /\/p-(\d+)\/?$/i;

/** Output locations (relative to project root, i.e. two levels up from this folder). */
export const OUT = {
  data: "../../data",
  media: "../../public/imported",
};

/** Old ecommerce wording -> new phone-first wording. Applied during normalise. */
export const CTA_WORDING: Record<string, string> = {
  "buy now": "View Details",
  "add to basket": "Call to Check Stock",
  "add to cart": "Call to Check Stock",
  "checkout": "Speak to the Store",
  "secure online shopping": "Visit our store",
  "safe online shopping": "Visit our store",
  "payment": "Call to arrange payment, delivery and fitting",
};

/** The client's confirmed store phone (also used to normalise availability copy). */
export const STORE_PHONE = "0208 864 5763";
export const STORE_PHONE_TEL = "tel:02088645763";
