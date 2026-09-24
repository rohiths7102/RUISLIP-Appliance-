import { loadCatalog, getBusiness } from "@/lib/repo";
import { topCategories } from "@/lib/select";
import { AREA_GROUPS, TOWNS } from "@/lib/areas";
import { SITE } from "@/lib/seo";
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

## Delivery towns
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
