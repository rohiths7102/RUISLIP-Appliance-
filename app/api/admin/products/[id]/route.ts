import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag, dropProductDoc } from "@/lib/rag/index";
import { EDITABLE, SCRAPE_OWNED, coerce, reconcileSaving, ValidationError, checkTaxonomy, loadCategories, findDuplicate } from "@/lib/admin-product";
import { recomputeCounts, ensureBrand } from "@/lib/counts";
import { revalidateStorefront } from "@/lib/revalidate";
import { setFeatured } from "@/lib/homepage";
export const dynamic = "force-dynamic";

const pick = (o: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));

/** Update a product: price, stock, visibility, copy, image. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  const { admin } = gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const db = await getPrisma();
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: Record<string, any> = {};
    const changed: string[] = [];
    for (const k of EDITABLE) {
      if (!(k in body)) continue;
      const v = coerce(k, body[k]);
      if (v !== (existing as any)[k]) { data[k] = v; changed.push(k); }
    }
    if (!changed.length) return NextResponse.json(existing);

    for (const k of ["title", "productCode", "brand"]) if (k in data && !data[k]) throw new ValidationError(`${k} cannot be empty`);
    if ("category" in data || "subcategory" in data) {
      Object.assign(data, checkTaxonomy(await loadCategories(db), data.category ?? existing.category, data.subcategory ?? existing.subcategory));
    }
    // File under the brand's stored spelling: call-for-price and the feed match it exactly.
    if ("brand" in data) data.brand = (await ensureBrand(db, data.brand)).name;
    if ("productCode" in data || "brand" in data) {
      const dup = await findDuplicate(db, data.productCode ?? existing.productCode, data.brand ?? existing.brand, id);
      if (dup) throw new ValidationError(`${dup.productCode} is already listed as "${dup.title}"`);
    }
    // The product page draws from the gallery, so the new photo leads it.
    if ("mainImage" in data) {
      const rest = ((existing.galleryImages as string[]) || []).filter((u) => u !== existing.mainImage && u !== data.mainImage);
      data.galleryImages = data.mainImage ? [data.mainImage, ...rest] : rest;
    }
    // Keep the browser/Google title in step with a rename, unless the owner wrote his own.
    if (("title" in data || "brand" in data) && !("seoTitle" in data)) {
      const auto = (b: string, t: string) => `${b || ""} ${t}`.trim().slice(0, 68);
      if (!existing.seoTitle || existing.seoTitle === auto(existing.brand, existing.title)) {
        data.seoTitle = auto(data.brand ?? existing.brand, data.title ?? existing.title);
      }
    }

    reconcileSaving(data, existing);

    // Lock edited fields so a future re-scrape can't silently undo the owner.
    const overrides = new Set<string>(((existing.adminOverrideFields as string[]) || []));
    for (const k of changed) if (SCRAPE_OWNED.has(k)) overrides.add(k);
    data.adminOverrideFields = [...overrides];
    data.lastUpdatedByAdmin = new Date();

    const updated = await db.product.update({ where: { id }, data });
    await writeAudit(db, {
      entityType: "product", entityId: id, action: "update", changedFields: changed,
      previousValue: pick(existing, changed), newValue: pick(updated, changed), changedBy: admin.email,
    });
    // A new code: the chatbot and the homepage row are keyed by code, so retire the old one.
    if (data.productCode && data.productCode !== existing.productCode) {
      await dropProductDoc(db, existing.productCode, id).catch(() => {});
      if (existing.featured) await setFeatured(db, [existing.productCode], false, admin.email);
      if (updated.featured && !changed.includes("featured")) await setFeatured(db, [updated.productCode], true, admin.email);
    }
    // Keep the chatbot's answers in step with the catalogue.
    try { await syncProductToRag(db, id); } catch { /* best effort */ }
    // "Featured" puts it on (or takes it off) the homepage row — Admin → Homepage.
    if (changed.includes("featured")) await setFeatured(db, [updated.productCode], updated.featured, admin.email);
    // Brand/category/visibility moves change the counts those pages display.
    if (changed.some((k) => ["brand", "category", "subcategory", "isVisible"].includes(k))) {
      try {
        await recomputeCounts(db, {
          brands: [existing.brand, updated.brand],
          categories: [existing.category, existing.subcategory, updated.category, updated.subcategory],
        });
      } catch { /* counts are best effort */ }
    }
    revalidateStorefront([`/products/${updated.slug}`]);
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("admin product PATCH", e);
    return NextResponse.json({ error: "Could not save. Is the database running? (npx prisma migrate dev)" }, { status: 500 });
  }
}

/** Remove a product from the catalogue. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  const { admin } = gate;
  const { id } = await params;
  try {
    const db = await getPrisma();
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.product.delete({ where: { id } });
    // Docs are keyed by productCode, and BSH part numbers are listed twice (Bosch
    // and Neff), so this must not take a surviving twin out of the chatbot.
    await dropProductDoc(db, existing.productCode).catch(() => {});
    // Off the homepage row too, unless a twin still carries the code.
    if (!(await db.product.findFirst({ where: { productCode: existing.productCode } }))) {
      await setFeatured(db, [existing.productCode], false, admin.email).catch(() => {});
    }
    await writeAudit(db, {
      entityType: "product", entityId: id, action: "delete", changedFields: ["*"],
      previousValue: { title: existing.title, productCode: existing.productCode, priceNow: existing.priceNow },
      newValue: {}, changedBy: admin.email,
    });
    try { await recomputeCounts(db, { brands: [existing.brand], categories: [existing.category, existing.subcategory] }); } catch { /* best effort */ }
    revalidateStorefront([`/products/${existing.slug}`]);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    console.error("admin product DELETE", e);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }
}
