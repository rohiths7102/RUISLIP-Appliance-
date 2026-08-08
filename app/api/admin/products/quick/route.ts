import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { coerce, slugify, reconcileSaving, ValidationError, AVAILABILITY } from "@/lib/admin-product";
import { recomputeCounts, ensureBrand } from "@/lib/counts";
import { revalidateStorefront } from "@/lib/revalidate";
import { classify, LEAF } from "../../../../../scripts/catalog/taxonomy.mjs";
export const dynamic = "force-dynamic";

/**
 * The owner's one-minute add: brand + model code + price + photos in, a fully
 * filed, live product out. Everything a developer used to do happens here —
 * classification (same taxonomy engine the bulk imports use), slug, brand row,
 * counts, chatbot doc, cache purge. The owner never sees the words "taxonomy"
 * or "revalidate"; he sees "filed under Cooking › Ovens" and a live link.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  const { admin } = gate;
  const b = await req.json().catch(() => ({}));

  const brand = String(b.brand || "").trim();
  // The admin field only LOOKS uppercase (that is CSS) — store the uppercase
  // form so a phone lookup and a CSV round trip (which matches codes uppercased)
  // find the same row whichever way the owner typed it.
  const productCode = String(b.productCode || "").trim().toUpperCase();
  const title = String(b.title || "").trim();
  const images: string[] = Array.isArray(b.images) ? b.images.filter((u: unknown) => typeof u === "string" && u).slice(0, 8) : [];
  if (!brand) return NextResponse.json({ error: "Brand is required" }, { status: 400 });
  if (!productCode) return NextResponse.json({ error: "Model code is required — customers quote it on the phone" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Product name is required" }, { status: 400 });

  try {
    const db = await getPrisma();

    // Same code twice = the same appliance — send the owner to the existing one
    // instead of silently creating a lookalike listing. Scraped codes are not
    // uniformly cased, and Prisma's case-insensitive filter is Postgres-only
    // while this schema also runs on SQLite, so the codes come back in one thin
    // projection and the fold happens here.
    const codes: { slug: string; title: string; productCode: string }[] =
      await db.product.findMany({ select: { slug: true, title: true, productCode: true } });
    const dup = codes.find((p) => p.productCode.trim().toUpperCase() === productCode);
    if (dup) {
      return NextResponse.json(
        { error: `${productCode} is already in the catalogue ("${dup.title}"). Edit it in Products instead.`, slug: dup.slug },
        { status: 409 },
      );
    }

    const priceNow = coerce("priceNow", b.priceNow);
    const priceWas = coerce("priceWas", b.priceWas);
    const availability = AVAILABILITY.includes(String(b.availability)) ? String(b.availability) : "in_stock";
    const shortDescription = String(b.shortDescription || "").trim();

    // ---- classification: the owner's pick wins; otherwise the taxonomy engine
    // files it from the words he typed (title + description + brand).
    let category = String(b.category || "").trim();
    let subcategory = String(b.subcategory || "").trim();
    let auto = false;
    if (!category) {
      try {
        const { leaf } = classify({
          name: `${brand} ${title}`,
          description: shortDescription || title,
          source: "admin",
          key: productCode,
        });
        const hit = LEAF.get(leaf);
        if (hit) { category = hit.topName; subcategory = hit.leafName; auto = true; }
      } catch { /* unclassifiable — created uncategorised, surfaced in the response */ }
    }

    const data: Record<string, number | null> = { priceNow, priceWas };
    reconcileSaving(data);

    const base = slugify(`${brand}-${productCode}`) || slugify(title);
    let slug = base;
    for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

    const created = await db.product.create({
      data: {
        slug, title, brand, productCode, category, subcategory,
        priceNow: data.priceNow, priceWas: data.priceWas, saving: data.saving ?? null,
        availabilityNormalised: availability,
        availabilityRaw: availability === "in_stock" ? "In stock" : "",
        warranty: "", shortDescription,
        descriptionText: shortDescription || title,
        mainImage: images[0] || "",
        galleryImages: images,
        isVisible: true, featured: false,
        // Everything the owner types is his — a re-scrape must never overwrite it.
        adminOverrideFields: ["title", "brand", "productCode", "priceNow", "priceWas", "availabilityNormalised", "shortDescription", "mainImage"],
        lastUpdatedByAdmin: new Date(),
        sourceUrl: "", oldUrl: "", currency: "GBP", descriptionHtml: "",
        breadcrumbs: [category, subcategory].filter(Boolean),
        specifications: [], features: [], relatedProductCodes: [], serviceAddOns: [],
        energyLabelUrl: "", deliveryNotes: "",
        seoTitle: `${brand} ${title}`.trim().slice(0, 68),
        seoDescription: `${brand} ${title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
      },
    });

    // ---- brand row + counts: shared implementation with every other mutation
    // path, and best-effort like them. The product row already exists at this
    // point, so a counts failure must not cost it the audit line, the chatbot
    // doc and the cache purge below — it would be live nowhere but the database.
    let brandCreated = false;
    try {
      const ensured = await ensureBrand(db, brand);
      brandCreated = ensured.created;
      await recomputeCounts(db, { brands: [ensured.name], categories: [category, subcategory] });
    } catch { /* best effort */ }

    await writeAudit(db, {
      entityType: "product", entityId: created.id, action: "create",
      changedFields: ["quick-add", ...(auto ? ["auto-classified"] : [])],
      previousValue: {}, newValue: { title, productCode, priceNow: data.priceNow, category, subcategory },
      changedBy: admin.email,
    });

    // The chatbot learns it, then every cached page forgets the old catalogue.
    try { await syncProductToRag(db, created.id); } catch { /* best effort */ }
    revalidateStorefront([`/products/${slug}`]);

    return NextResponse.json({
      ok: true, slug, url: `/products/${slug}`,
      classified: category ? { category, subcategory, auto } : null,
      brandCreated,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("quick add", e);
    return NextResponse.json({ error: "Could not create the product. Is the database running?" }, { status: 500 });
  }
}
