import { NextResponse } from "next/server";
import { getAdmin, requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { EDITABLE, coerce, slugify, reconcileSaving, ValidationError } from "@/lib/admin-product";
import { recomputeCounts, ensureBrand } from "@/lib/counts";
import { revalidateStorefront } from "@/lib/revalidate";
import { setFeatured } from "@/lib/homepage";
export const dynamic = "force-dynamic";

/** List products for the admin table (search + paginate server-side over ~1,600). */
export async function GET(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const take = Math.min(Number(searchParams.get("take")) || 25, 100);
  const skip = Math.max(Number(searchParams.get("skip")) || 0, 0);

  const select = {
    id: true, title: true, brand: true, productCode: true, category: true, subcategory: true,
    priceNow: true, priceWas: true, availabilityNormalised: true, warranty: true,
    shortDescription: true, deliveryNotes: true, mainImage: true, slug: true, isVisible: true, featured: true,
    adminOverrideFields: true,
  };
  const orderBy = [{ lastUpdatedByAdmin: "desc" }, { title: "asc" }];

  try {
    const db = await getPrisma();
    if (!q) {
      const [rows, total] = await Promise.all([
        db.product.findMany({ orderBy, take, skip, select }),
        db.product.count(),
      ]);
      return NextResponse.json({ rows, total, take, skip });
    }

    // Search is case-blind and word-by-word: "NEFF", "bosch oven" and
    // "hhf 113" must all find what the owner means. A plain `contains` is
    // case-sensitive on Postgres, so "NEFF" found nothing against "Neff", and
    // Prisma's insensitive mode is Postgres-only while this schema also runs on
    // SQLite — so, as in lib/counts.ts, a thin projection is matched here.
    // Every word must appear in code, title, brand or category; punctuation is
    // ignored too, so a model code matches with or without its spaces/dashes.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const all: { id: string; productCode: string; title: string; brand: string; category: string; subcategory: string }[] =
      await db.product.findMany({ orderBy, select: { id: true, productCode: true, title: true, brand: true, category: true, subcategory: true } });
    const hits = all.filter((r) => {
      const text = `${r.productCode} ${r.title} ${r.brand} ${r.category} ${r.subcategory}`.toLowerCase();
      const flat = squash(text);
      return words.every((w) => text.includes(w) || (squash(w) && flat.includes(squash(w))));
    });
    // The exact model code first: typing a code means "that one".
    const code = squash(q);
    hits.sort((a, b) => Number(squash(b.productCode) === code) - Number(squash(a.productCode) === code));
    const page = hits.slice(skip, skip + take).map((r) => r.id);
    const found = page.length ? await db.product.findMany({ where: { id: { in: page } }, select }) : [];
    const byId = new Map(found.map((r: any) => [r.id, r]));
    return NextResponse.json({ rows: page.map((id) => byId.get(id)).filter(Boolean), total: hits.length, take, skip });
  } catch (e) {
    console.error("admin products GET", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }
}

/** Create a product. */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  const { admin } = gate;
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
        relatedProductCodes: [], serviceAddOns: [], energyLabelUrl: "", deliveryNotes: data.deliveryNotes || "",
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
    if (created.featured) await setFeatured(db, [created.productCode], true, admin.email);
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
