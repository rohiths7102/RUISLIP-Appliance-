import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/repo";
import { poaNamesFrom, slugOf } from "@/lib/select";

export const dynamic = "force-dynamic";

/**
 * Header type-ahead. Same haystack as ProductBrowser (title + brand + code) so
 * the dropdown never disagrees with the grid a submit lands on. Call-for-price
 * items return priceNow:null — the owner's withheld numbers stay withheld in
 * every payload, suggestions included.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ suggestions: [], items: [], total: 0 });

  const { products, categories, brands } = await loadCatalog();
  const poa = poaNamesFrom(categories);

  // Department / brand rows above the products — name matches only, prefix
  // matches first, two of each so the product list stays the star.
  const byName = (name: string) => {
    const n = name.toLowerCase();
    return n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0;
  };
  const suggestions = [
    ...categories
      .map((c) => [byName(c.name), c] as const)
      .filter(([s, c]) => s > 0 && c.productCount > 0)
      .sort((a, b) => b[0] - a[0] || b[1].productCount - a[1].productCount)
      .slice(0, 2)
      .map(([, c]) => ({ kind: "category" as const, name: c.name, href: `/categories/${c.id}`, count: c.productCount })),
    ...brands
      .map((b) => [byName(b.name), b] as const)
      .filter(([s, b]) => s > 0 && b.productCount > 0)
      .sort((a, b) => b[0] - a[0] || b[1].productCount - a[1].productCount)
      .slice(0, 2)
      .map(([, b]) => ({ kind: "brand" as const, name: b.name, href: `/brands/${b.slug}`, count: b.productCount })),
  ];

  const scored: [number, (typeof products)[number]][] = [];
  for (const p of products) {
    if (!`${p.title} ${p.brand} ${p.productCode}`.toLowerCase().includes(q)) continue;
    let s = 1;
    if (p.productCode.toLowerCase().startsWith(q)) s += 4;
    const brand = p.brand.toLowerCase();
    if (brand === q) s += 3;
    else if (brand.startsWith(q)) s += 2;
    if (p.image) s += 0.5; // photographed first — the dropdown is visual
    scored.push([s, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));

  const items = scored.slice(0, 6).map(([, p]) => {
    const hidden = poa.has(p.category) || poa.has(p.subcategory);
    return {
      slug: slugOf(p), title: p.title, brand: p.brand, productCode: p.productCode,
      image: p.image, priceNow: hidden ? null : p.priceNow, poa: hidden,
    };
  });

  return NextResponse.json(
    { suggestions, items, total: scored.length },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
