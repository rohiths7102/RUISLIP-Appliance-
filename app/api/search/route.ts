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
  if (q.length < 2) return NextResponse.json({ items: [], total: 0 });

  const { products, categories } = await loadCatalog();
  const poa = poaNamesFrom(categories);

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
    { items, total: scored.length },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
