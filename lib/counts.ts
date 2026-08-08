import { slugify } from "@/lib/admin-product";

/**
 * Keep the numbers the storefront displays true after any product mutation.
 * Every admin write path that creates/deletes products or moves them between
 * brands/categories/visibility calls these — one implementation, no drift.
 *
 * Names are matched case-blind: the catalogue really does hold "NUTRIBULLET"
 * and "Nutribullet" for one brand. Prisma's `mode: "insensitive"` is
 * Postgres-only and this schema also runs on SQLite, so the fold happens here,
 * over rows fetched in a single round trip.
 */
const fold = (s: string) => s.trim().toLowerCase();

/** Recompute productCount for the named brands and categories (visible products only). */
export async function recomputeCounts(db: any, opts: { brands?: (string | null | undefined)[]; categories?: (string | null | undefined)[] } = {}) {
  const brandNames = new Set(((opts.brands || []).filter(Boolean) as string[]).map(fold));
  const catNames = new Set(((opts.categories || []).filter(Boolean) as string[]).map(fold));
  if (!brandNames.size && !catNames.size) return;

  // One query per entity instead of three per name: a CSV import touches ~70
  // names, and a round trip apiece runs the function past its timeout.
  const [brandRows, catRows, byBrand, byCategory, bySubcategory] = await Promise.all([
    brandNames.size ? db.brand.findMany({ select: { id: true, name: true } }) : [],
    catNames.size ? db.category.findMany({ select: { id: true, name: true, parentId: true } }) : [],
    brandNames.size ? db.product.groupBy({ by: ["brand"], where: { isVisible: true }, _count: { _all: true } }) : [],
    catNames.size ? db.product.groupBy({ by: ["category"], where: { isVisible: true }, _count: { _all: true } }) : [],
    catNames.size ? db.product.groupBy({ by: ["subcategory"], where: { isVisible: true }, _count: { _all: true } }) : [],
  ]);

  // A brand page lists its products case-blind (productsForBrand), so the count
  // above it folds the same way or a "NUTRIBULLET" product goes missing from the
  // "Nutribullet" total. Categories stay an exact match, as they are on the pages.
  const brandTotals = new Map<string, number>();
  for (const g of byBrand as { brand: string; _count: { _all: number } }[]) {
    const k = fold(g.brand);
    brandTotals.set(k, (brandTotals.get(k) || 0) + g._count._all);
  }
  const catTotals = new Map<string, number>();
  for (const g of byCategory as { category: string; _count: { _all: number } }[]) catTotals.set(g.category, g._count._all);
  const subTotals = new Map<string, number>();
  for (const g of bySubcategory as { subcategory: string; _count: { _all: number } }[]) subTotals.set(g.subcategory, g._count._all);

  const updates = [
    ...(brandRows as { id: string; name: string }[])
      .filter((b) => brandNames.has(fold(b.name)))
      .map((b) => db.brand.update({ where: { id: b.id }, data: { productCount: brandTotals.get(fold(b.name)) || 0 } })),
    ...(catRows as { id: string; name: string; parentId: string | null }[])
      .filter((c) => catNames.has(fold(c.name)))
      .map((c) => db.category.update({ where: { id: c.id }, data: { productCount: (c.parentId ? subTotals : catTotals).get(c.name) || 0 } })),
  ];
  if (updates.length) await db.$transaction(updates);
}

/** A product's brand must exist as a Brand row or it has no page, no rail spot,
 *  no search suggestion. The match folds case: "bosch" would otherwise miss the
 *  existing "Bosch" and then collide on the slug (which folds case anyway), a
 *  P2002 raised AFTER the product row was already written. Returns the canonical
 *  row name so callers file against the spelling the storefront already shows. */
export async function ensureBrand(db: any, name: string): Promise<{ created: boolean; name: string }> {
  const trimmed = (name || "").trim();
  if (!trimmed) return { created: false, name: trimmed };
  const slug = slugify(trimmed);
  const rows: { name: string; slug: string }[] = await db.brand.findMany({ select: { name: true, slug: true } });
  const existing = rows.find((b) => b.slug === slug || fold(b.name) === fold(trimmed));
  if (existing) return { created: false, name: existing.name };
  await db.brand.create({ data: { name: trimmed, slug, productCount: 0 } });
  return { created: true, name: trimmed };
}
