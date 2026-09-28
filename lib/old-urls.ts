import { classify } from "@/scripts/catalog/taxonomy.mjs";
import oldSite from "@/data/old-site-redirects.json";
import older from "@/data/redirects.json";
import merged from "@/data/product-redirects.json";

// The migration crawl's own product mappings, by old product id (p-5468 →
// /products/…). They used to be fixed redirects in next.config.mjs, but 45 of
// them pointed at products since removed; here "still on the site" is checked.
const KNOWN = new Map<string, string>();
for (const [from, to] of [...oldSite.map((r) => [r.source, r.destination]), ...older.map((r) => [r.oldUrl, r.newUrl])]) {
  const id = from.match(/\/p-(\d+)$/)?.[1];
  if (id && to.startsWith("/products/") && !KNOWN.has(id)) KNOWN.set(id, to);
}
const MERGED = new Map(merged.map((r) => [r.source, r.destination])); // duplicate listings merged 24 Sept 2026

type Catalogue = {
  products: { productCode: string; brand: string; newSlug: string }[];
  categories: { id: string }[];
  brands: { slug: string }[];
};

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Where an address from the old site should send a visitor now, or null for a
 * real 404.
 *
 * Google still holds the old site's pages (/<name>/p-<id> for products,
 * /<department>/<section> for departments) and kept sending shoppers to them
 * after the 22 Sept 2026 switch-over. Each answered 404, which also throws away
 * the ranking that page had earned. next.config.mjs redirects the 208 the
 * migration crawl saw; the old site had thousands, so the rest resolve here:
 *   0. the migration's own mapping for that product id, if the product is still on the site
 *   1. a model code written in the old address → that product
 *   2. the product type the address names → its department page
 *   3. an old product address starting with a brand → the brand page
 * An address that says none of these stays a 404: sending it somewhere
 * unrelated would only be a soft 404 to Google.
 */
export function oldAddressTarget(path: string, cat: Catalogue): string | null {
  const p = path.toLowerCase().replace(/\/+$/, "");
  const product = p.match(/^\/([a-z0-9-]+)\/p-(\d+)$/);
  if (!product && !/^(\/[a-z0-9-]+){1,3}$/.test(p)) return null;
  const words = (product ? product[1] : p).split(/[-/]+/).filter(Boolean);

  if (product) {
    const live = new Set(cat.products.map((x) => x.newSlug));
    const known = KNOWN.get(product[2]);
    const target = known && (live.has(known) ? known : MERGED.get(known));
    if (target && live.has(target)) return target;

    const byCode = new Map<string, Catalogue["products"]>();
    for (const x of cat.products) { const k = squash(x.productCode); byCode.set(k, [...(byCode.get(k) || []), x]); }
    // Codes are sometimes split by the old slug ("yc-ma262ae-b"), so try runs of up to three words.
    for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
      const code = squash(words.slice(i, i + n).join(""));
      const hits = code.length >= 5 && /\d/.test(code) ? byCode.get(code) : undefined;
      // Bosch and Neff share part numbers: prefer the brand the address starts with.
      if (hits) return (hits.find((h) => squash(h.brand) === squash(words[0])) || hits[0]).newSlug;
    }
  }

  const ids = new Set(cat.categories.map((c) => c.id));
  // Department addresses are plural ("/cooking/cooker-hoods"); the rules match
  // "hood", "hob", "fridge", so singularise before asking them.
  const name = words.map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join(" ");
  let leaf = "";
  try { leaf = classify({ name, description: name, source: "euronics", key: p }).leaf; } catch { /* names no product type */ }
  if (ids.has(leaf)) return `/categories/${leaf}`;
  // The old site's own department names ("/floorcare/…", "/dishwashing/…").
  const dept = p.split("/")[1];
  const renamed = ({ dishwashing: "dishwashers", "tv-blu-ray--audio": "tv-audio" } as Record<string, string>)[dept] || dept;
  if (!product && ids.has(renamed)) return `/categories/${renamed}`;
  const brand = product && cat.brands.find((b) => b.slug === words[0]);
  return brand ? `/brands/${brand.slug}` : null;
}
