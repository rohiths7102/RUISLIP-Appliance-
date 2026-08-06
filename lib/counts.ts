import { slugify } from "@/lib/admin-product";

/**
 * Keep the numbers the storefront displays true after any product mutation.
 * Every admin write path that creates/deletes products or moves them between
 * brands/categories/visibility calls these — one implementation, no drift.
 */

/** Recompute productCount for the named brands and categories (visible products only). */
export async function recomputeCounts(db: any, opts: { brands?: (string | null | undefined)[]; categories?: (string | null | undefined)[] } = {}) {
  const brandNames = [...new Set((opts.brands || []).filter(Boolean))] as string[];
  const catNames = [...new Set((opts.categories || []).filter(Boolean))] as string[];

  for (const name of brandNames) {
    const b = await db.brand.findFirst({ where: { name } });
    if (b) await db.brand.update({ where: { id: b.id }, data: { productCount: await db.product.count({ where: { brand: name, isVisible: true } }) } });
  }
  for (const name of catNames) {
    const c = await db.category.findFirst({ where: { name } });
    if (!c) continue;
    const where = c.parentId ? { subcategory: name, isVisible: true } : { category: name, isVisible: true };
    await db.category.update({ where: { id: c.id }, data: { productCount: await db.product.count({ where }) } });
  }
}

/** A product's brand must exist as a Brand row or it has no page, no rail spot,
 *  no search suggestion. Returns true when a new brand row was created. */
export async function ensureBrand(db: any, name: string): Promise<boolean> {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  const existing = await db.brand.findFirst({ where: { name: trimmed } });
  if (existing) return false;
  await db.brand.create({ data: { name: trimmed, slug: slugify(trimmed), productCount: 0 } });
  return true;
}
