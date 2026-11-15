import { loadCatalog, getBusiness } from "@/lib/repo";
import { topCategories } from "@/lib/select";
import { AREA_GROUPS, TOWNS } from "@/lib/areas";
import { SITE } from "@/lib/seo";
import { getPrisma } from "@/lib/prisma";
export const revalidate = 86400;

/**
 * /llms.txt — the shop in plain Markdown for AI answer engines (ChatGPT,
 * Gemini, Perplexity, Claude): who we are, where we deliver, what we sell and
 * where to read more. Built from the same live data as the site (catalogue,
 * business details, lib/areas.ts) so it can never disagree with it.
 * Format: https://llmstxt.org
 */
export async function GET() {
  const [{ categories, brands }, b] = await Promise.all([loadCatalog(), getBusiness()]);
  const base = SITE().replace(/\/+$/, "");
  const addr = [b.address.line1, b.address.line2, b.address.postcode].filter(Boolean).join(", ");
  const hours = Object.entries(b.openingHours || {}).map(([d, h]) => `${d} ${h}`).join("; ");
  const depts = topCategories(categories).filter((c) => (c.productCount ?? 0) > 0);
  const topBrands = [...brands].sort((x, y) => y.productCount - x.productCount).slice(0, 30);
  // The product pages shoppers look at most this month (each has buyer Q&A on it once the GEO agent reaches it).
  const popular: { slug: string; title: string; brand: string; productCode: string }[] = await getPrisma().then(async (db) => {
    const v: any[] = await db.trackedEvent.groupBy({ by: ["productSlug"], where: { type: "page_view", productSlug: { not: "" }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true }, orderBy: { _count: { productSlug: "desc" } }, take: 25 });
    const ps: any[] = await db.product.findMany({ where: { slug: { in: v.map((x) => x.productSlug) }, isVisible: true }, select: { slug: true, title: true, brand: true, productCode: true } });
    const at = new Map(v.map((x, i) => [x.productSlug, i]));
    return ps.sort((a, b) => at.get(a.slug)! - at.get(b.slug)!);
  }).catch(() => []);

  const name = b.businessName && b.businessName !== b.tradingName ? `${b.businessName} (${b.tradingName})` : b.tradingName || b.businessName;
  const body = `# ${name}

> Family-run independent electrical retailer in South Ruislip, West London, trading since 1977 and a member of the Euronics buying group. Sells kitchen and home appliances, delivers them in its own van and fits them, and recycles the old appliance. Prices are kept in line with Euronics nightly. There is no online checkout: customers call ${b.phone} or visit the shop to confirm stock, price, delivery and fitting.

- Phone: ${b.phone}
- Shop: ${addr}${hours ? `\n- Opening hours: ${hours}` : ""}
- Delivery: own van, usually within a day or two when in stock locally; installation and old-appliance recycling available
- Delivery area: ${AREA_GROUPS.join(", ")} postcodes — ${TOWNS.length} towns including ${TOWNS.slice(0, 12).map((t) => t.name).join(", ")} and more

## Departments
${depts.map((c) => `- [${c.name}](${base}/categories/${c.id}): ${c.productCount} models`).join("\n")}

## Brands (most models first)
${topBrands.map((x) => `- [${x.name}](${base}/brands/${x.slug}): ${x.productCount} models`).join("\n")}

${popular.length ? `## Popular appliances this month
${popular.map((x) => `- [${x.brand} ${x.productCode}: ${x.title}](${base}/products/${x.slug})`).join("\n")}

` : ""}## Delivery towns
${AREA_GROUPS.map((g) => `- ${g}: ${TOWNS.filter((t) => t.group === g).map((t) => `[${t.name}](${base}/areas/${t.slug})`).join(", ")}`).join("\n")}

## Key pages
- [All products](${base}/products): search by model code, brand or name
- [Delivery & services](${base}/delivery-services): delivery, installation, recycling
- [Areas we deliver to](${base}/areas)
- [About the shop](${base}/about)
- [Contact](${base}/contact)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
