import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { EDITABLE, coerce, slugify, reconcileSaving, ValidationError } from "@/lib/admin-product";
import { recomputeCounts, ensureBrand } from "@/lib/counts";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";

/** List products for the admin table (search + paginate server-side over ~1,600). */
export async function GET(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const take = Math.min(Number(searchParams.get("take")) || 25, 100);
  const skip = Math.max(Number(searchParams.get("skip")) || 0, 0);

  try {
    const db = await getPrisma();
    const where = q
      ? { OR: [{ title: { contains: q } }, { brand: { contains: q } }, { productCode: { contains: q } }] }
      : {};
    const [rows, total] = await Promise.all([
      db.product.findMany({
        where, orderBy: [{ lastUpdatedByAdmin: "desc" }, { title: "asc" }], take, skip,
        select: {
          id: true, title: true, brand: true, productCode: true, category: true, subcategory: true,
          priceNow: true, priceWas: true, availabilityNormalised: true, warranty: true,
          shortDescription: true, mainImage: true, slug: true, isVisible: true, featured: true,
          adminOverrideFields: true,
        },
      }),
      db.product.count({ where }),
    ]);
    return NextResponse.json({ rows, total, take, skip });
  } catch (e) {
    console.error("admin products GET", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }
}

/** Create a product. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (!body.title || !String(body.title).trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!body.productCode || !String(body.productCode).trim())
    return NextResponse.json({ error: "Product code is required — customers quote it on the phone" }, { status: 400 });

  try {
    const db = await getPrisma();
    const data: Record<string, any> = {};
    for (const k of EDITABLE) if (k in body) data[k] = coerce(k, body[k]);
    reconcileSaving(data);

    // Unique slug: base it on brand + code, then disambiguate.
    const base = slugify(`${data.brand || "product"}-${data.productCode}`) || slugify(String(data.title));
    let slug = base;
    for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

    const created = await db.product.create({
      data: {
        slug,
        title: data.title,
        brand: data.brand || "Unbranded",
        productCode: data.productCode,
        category: data.category || "",
        subcategory: data.subcategory || "",
        priceNow: data.priceNow ?? null,
        priceWas: data.priceWas ?? null,
        saving: data.saving ?? null,
        availabilityNormalised: data.availabilityNormalised || "call_to_confirm",
        availabilityRaw: data.availabilityRaw || "",
        warranty: data.warranty || "",
        shortDescription: data.shortDescription || "",
        descriptionText: data.descriptionText || data.shortDescription || "",
        mainImage: data.mainImage || "",
        isVisible: data.isVisible ?? true,
        featured: data.featured ?? false,
        // Everything the owner types is theirs — a re-scrape must never overwrite it.
        adminOverrideFields: Object.keys(data),
        lastUpdatedByAdmin: new Date(),
        sourceUrl: "", oldUrl: "", currency: "GBP", descriptionHtml: "",
        breadcrumbs: [data.category, data.subcategory].filter(Boolean),
        specifications: [], features: [], galleryImages: data.mainImage ? [data.mainImage] : [],
        relatedProductCodes: [], serviceAddOns: [], energyLabelUrl: "", deliveryNotes: "",
        seoTitle: `${data.brand || ""} ${data.title}`.trim().slice(0, 68),
        seoDescription: `${data.title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
      },
    });

    await writeAudit(db, {
      entityType: "product", entityId: created.id, action: "create", changedFields: Object.keys(data),
      previousValue: {}, newValue: { title: created.title, productCode: created.productCode, priceNow: created.priceNow },
      changedBy: admin.email,
    });
    try { await syncProductToRag(db, created.id); } catch { /* best effort */ }
    // A brand-new brand gets its page; the counts the storefront shows follow.
    try {
      await ensureBrand(db, created.brand);
      await recomputeCounts(db, { brands: [created.brand], categories: [created.category, created.subcategory] });
    } catch { /* best effort */ }
    revalidateStorefront([`/products/${created.slug}`]);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("admin products POST", e);
    return NextResponse.json({ error: "Could not create. Is the database running?" }, { status: 500 });
  }
}
