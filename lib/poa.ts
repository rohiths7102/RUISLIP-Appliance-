import { poaNamesFrom } from "./select";

/**
 * The call-for-price category names, read straight from the database.
 *
 * Server paths that don't go through loadCatalog (the chatbot index, the AI
 * reply drafter, the admin dashboards) used to ask for
 * `where: { priceOnApplication: true }` and take the answer literally. That
 * query cannot tell "the owner unticked it" from "the flag never arrived", so
 * on a restored or pre-flag database it returns nothing and those paths quote
 * the supplier-cost prices the owner withholds. Routing them through
 * poaNamesFrom gives them the same fallback the storefront has, from one
 * definition.
 */
export async function poaNamesFromDb(db: any): Promise<Set<string>> {
  const cats = await db.category.findMany({ select: { name: true, priceOnApplication: true } });
  return poaNamesFrom(cats);
}

/** True when a product's own category or sub-category is call-for-price. */
export const isPoaProduct = (poa: Set<string>, p: { category?: string | null; subcategory?: string | null }) =>
  poa.has(p.category || "") || poa.has(p.subcategory || "");
