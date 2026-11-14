import { callGroq } from "@/lib/chat/groq";
import { searchAnalytics } from "@/lib/search-console";
import { SITE } from "@/lib/seo";

/**
 * A search title and description for one page, written from what the page
 * really is (product or department) and the searches Google matched it to in
 * the last 28 days. No price: Pricewire changes prices daily, and a price in
 * search text would go stale. Saves nothing. Used by Admin → SEO / Pricewire → Market
 * (api/admin/seo/suggest) and by scripts that fill a list of pages.
 */
export async function suggestSeo(db: any, kind: "product" | "category", id: string, path: string): Promise<{ title: string; description: string; queries: string[] } | null> {
  const row = kind === "product"
    ? await db.product.findUnique({ where: { id }, select: { title: true, brand: true, category: true, subcategory: true, shortDescription: true, warranty: true } })
    : await db.category.findUnique({ where: { id }, select: { name: true, description: true, productCount: true } });
  if (!row) return null;
  const queries = ((await searchAnalytics(db, "query", 28, `${SITE().replace(/\/+$/, "")}${path}`).catch(() => null)) || [])
    .sort((a, b) => b.impressions - a.impressions).slice(0, 8).map((q) => q.key);

  const facts = kind === "product"
    ? `Product: ${row.brand} ${row.title}. Department: ${row.category} / ${row.subcategory}. ${row.warranty ? `Warranty: ${row.warranty}.` : ""} ${row.shortDescription || ""}`
    : `Department page: ${row.name} (${row.productCount} models). ${row.description || ""}`;
  const text = await callGroq([
    { role: "system", content: `You write search titles and descriptions for Jyotsna Electrical (Euronics Ruislip), a family-run appliance shop in South Ruislip, West London, that delivers in its own van and fits appliances across the HA, UB, W3–W6, WD3–WD24 and SL postcodes. Rules: title at most 58 characters (count them) with the product or department first and a local hook (Ruislip / West London / delivered & fitted); description at most 150 characters, plain British English, answers the search, no exclamation marks, no claims not in the facts, and never a price (prices change daily; Google shows the live price beside the result). Delivery and fitting are paid services: never call anything free. Reply with JSON only: {"title": "...", "description": "..."}` },
    { role: "user", content: `Facts: ${facts}\nSearches Google matched this page to: ${queries.length ? queries.join("; ") : "none recorded yet"}` },
  ], { timeoutMs: 20000, temperature: 0.4 });
  const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  const title = String(j.title || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const description = String(j.description || "").replace(/\s+/g, " ").trim().slice(0, 170);
  if (!title) throw new Error("The AI didn't return a usable title.");
  return { title, description, queries };
}
