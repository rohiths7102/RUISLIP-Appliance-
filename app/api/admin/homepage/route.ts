import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getHomepage, saveHomepage, HomepageError, DEFAULT_SLIDES, FEATURED_SHOWN } from "@/lib/homepage";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";

/**
 * Admin → Homepage: the hero slideshow and the featured-products row.
 *
 *   GET                 the saved choices, every product they name (so the
 *                       screen can show photos and warn about gaps), the brands
 *   GET ?suggest=Bosch  three good products to lead a Bosch slide
 *   PUT { slides, featured }   save (lib/homepage.ts validates)
 */
const CARD = { id: true, productCode: true, title: true, brand: true, subcategory: true, mainImage: true, priceNow: true, isVisible: true, slug: true };

export async function GET(req: Request) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  try {
    const db = await getPrisma();
    const suggest = new URL(req.url).searchParams.get("suggest");
    if (suggest !== null) return NextResponse.json({ codes: await suggestFor(db, suggest) });

    const home = await getHomepage(db);
    const codes = [...new Set([...home.slides.flatMap((s) => s.codes), ...home.featured.map((f) => f.code)])];
    const [products, brands] = await Promise.all([
      db.product.findMany({ where: { productCode: { in: codes } }, select: CARD }),
      db.brand.findMany({ where: { isVisible: true }, select: { name: true, productCount: true }, orderBy: { name: "asc" } }).catch(() => []),
    ]);
    return NextResponse.json({ ...home, products, brands, defaults: DEFAULT_SLIDES, featuredShown: FEATURED_SHOWN });
  } catch (e) {
    console.error("admin homepage GET", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => null);
  try {
    const db = await getPrisma();
    const saved = await saveHomepage(db, body, gate.admin.email);
    revalidateStorefront(["/"]);
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof HomepageError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("admin homepage PUT", e);
    return NextResponse.json({ error: "Could not save. Is the database running?" }, { status: 500 });
  }
}

/** Three on-sale, photographed products from different departments, dearest first. */
async function suggestFor(db: any, brand: string): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { isVisible: true, priceNow: { not: null }, mainImage: { not: "" } },
    select: { productCode: true, brand: true, subcategory: true, priceNow: true },
    orderBy: { priceNow: "desc" },
  });
  const pool = brand ? rows.filter((r: any) => r.brand.toLowerCase() === brand.toLowerCase()) : rows;
  const picked: string[] = [];
  const depts = new Set<string>();
  for (const r of pool) if (!depts.has(r.subcategory) && picked.length < 3) { depts.add(r.subcategory); picked.push(r.productCode); }
  for (const r of pool) if (picked.length < 3 && !picked.includes(r.productCode)) picked.push(r.productCode);
  return picked;
}
