import { getPrisma } from "../prisma";
import { loadCatalog } from "../repo";
import { buildDocuments, productDoc, businessDocs, faqDocs, categoryDoc, brandDoc, type RagDoc } from "./documents";
import { retrieve, retrieveSemantic, type Doc, type Hit } from "./retriever";
import { embedText, embeddingsEnabled } from "./embed";

const docId = (sourceType: string, sourceId: string) => `${sourceType}:${sourceId}`;

/** Shared upsert of a single RAG document (computes an embedding only if configured). */
async function upsertDoc(db: any, d: RagDoc): Promise<void> {
  const id = docId(d.sourceType, d.sourceId);
  let embedding: number[] = [];
  if (embeddingsEnabled()) { const v = await embedText(`${d.title}. ${d.content}`); if (v) embedding = v; }
  await db.rAGDocument.upsert({
    where: { id },
    update: { title: d.title, content: d.content, metadata: d.metadata, embedding, needsReindex: false },
    create: { id, sourceType: d.sourceType, sourceId: d.sourceId, title: d.title, content: d.content, metadata: d.metadata, embedding },
  });
}

export async function buildDocsFromCatalog(): Promise<RagDoc[]> { return buildDocuments(await loadCatalog()); }

/** Full (re)build of the RAG index from the live catalogue. */
export async function buildIndex(db: any): Promise<{ indexed: number; embedded: boolean }> {
  const docs = await buildDocsFromCatalog();
  for (const d of docs) await upsertDoc(db, d);
  return { indexed: docs.length, embedded: embeddingsEnabled() };
}

/** Reindex a single product (called after an admin product edit). */
export async function syncProductToRag(db: any, productId: string): Promise<boolean> {
  const r = await db.product.findUnique({ where: { id: productId } });
  if (!r) return false;
  // A product the owner has hidden from the storefront must not survive in the
  // chatbot's context either — the bot would otherwise recommend (and leak the
  // price of) something the shop chose not to show. Product docs are keyed by
  // productCode (see productDoc), NOT the DB id.
  if (!r.isVisible) {
    await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: r.productCode } }).catch(() => {});
    return true;
  }
  // Call-for-price category -> the doc must not carry a number the bot could quote.
  const poaHit = await db.category.count({
    where: { priceOnApplication: true, name: { in: [r.category, r.subcategory].filter(Boolean) } },
  });
  const p: any = { title: r.title, productCode: r.productCode, brand: r.brand, category: r.category, subcategory: r.subcategory, priceNow: r.priceNow, priceWas: r.priceWas, saving: r.saving, warranty: r.warranty, shortDescription: r.shortDescription, specifications: r.specifications || [], features: r.features || [], image: r.mainImage, newSlug: `/products/${r.slug}` };
  await upsertDoc(db, productDoc(p, { omitPrice: poaHit > 0 }));
  return true;
}

/** Reindex the business + FAQ documents (after an admin business edit). */
export async function syncBusinessToRag(db: any): Promise<boolean> {
  const r = await db.businessInfo.findUnique({ where: { id: "business" } });
  if (!r) return false;
  const business: any = { businessName: r.businessName, tradingName: r.tradingName, phone: r.phone, email: r.email, address: r.address, openingHours: r.openingHours, delivery: { radius: r.deliveryRadius, notes: r.deliveryNotes, timescale: "" }, socialLinks: r.socialLinks, mapQuery: r.mapQuery, googleMapsEmbedUrl: r.googleMapsEmbedUrl, googleMapsDirectionsUrl: r.googleMapsDirectionsUrl };
  for (const d of [...businessDocs(business), ...faqDocs(business)]) await upsertDoc(db, d);
  return true;
}
export async function syncCategoryToRag(db: any, id: string): Promise<boolean> {
  const r = await db.category.findUnique({ where: { id } }); if (!r) return false;
  await upsertDoc(db, categoryDoc({ id: r.id, name: r.name, slug: r.slug, sourceUrl: r.sourceUrl, parentCategory: r.parentId || "", children: [], description: r.description, productCount: r.productCount, image: r.image, seoTitle: r.seoTitle, seoDescription: r.seoDescription } as any));
  return true;
}

/**
 * Rewrite the product docs of a category whose call-for-price flag flipped, so
 * the admin checkbox alone keeps its promise ("hide prices for every product in
 * this category") without a manual rag:build. Embeddings are deliberately NOT
 * recomputed — one API call per product would stall the admin write for
 * hundreds of accessories. Only the price sentence changes, so the stale vector
 * stays a fine retrieval key; needsReindex marks the docs for the next
 * rag:build. Writes go out in chunked transactions (one round trip apiece).
 */
export async function syncCategoryProductsToRag(db: any, categoryId: string): Promise<number> {
  const c = await db.category.findUnique({ where: { id: categoryId } });
  if (!c) return 0;
  const rows = await db.product.findMany({ where: { isVisible: true, OR: [{ category: c.name }, { subcategory: c.name }] } });
  if (!rows.length) return 0;
  // Recompute against ALL flagged categories: a product this category reaches by
  // name may still be covered by its other (category|subcategory) name.
  const poaNames = new Set(
    (await db.category.findMany({ where: { priceOnApplication: true }, select: { name: true } })).map((x: { name: string }) => x.name),
  );
  const writes = rows.map((r: any) => {
    const p: any = { title: r.title, productCode: r.productCode, brand: r.brand, category: r.category, subcategory: r.subcategory, priceNow: r.priceNow, priceWas: r.priceWas, saving: r.saving, warranty: r.warranty, shortDescription: r.shortDescription, specifications: r.specifications || [], features: r.features || [], image: r.mainImage, newSlug: `/products/${r.slug}` };
    const d = productDoc(p, { omitPrice: poaNames.has(r.category) || poaNames.has(r.subcategory) });
    // updateMany: a product the index hasn't met yet (empty/partial index) is a
    // no-op here, not an error — buildIndex owns creation.
    return db.rAGDocument.updateMany({
      where: { id: docId(d.sourceType, d.sourceId) },
      data: { title: d.title, content: d.content, metadata: d.metadata, needsReindex: embeddingsEnabled() },
    });
  });
  for (let i = 0; i < writes.length; i += 250) await db.$transaction(writes.slice(i, i + 250));
  return rows.length;
}
export async function syncBrandToRag(db: any, id: string): Promise<boolean> {
  const r = await db.brand.findUnique({ where: { id } }); if (!r) return false;
  await upsertDoc(db, brandDoc({ id: r.id, name: r.name, slug: r.slug, sourceUrl: r.sourceUrl, logo: r.logo, productCount: r.productCount } as any));
  return true;
}

/** Retrieve grounded context. Uses the DB index if built; otherwise builds
 * documents from the LIVE catalogue (DB, or seed if no DB) so results always
 * reflect current data — even before `rag:build` is run. */
export async function searchIndex(query: string, k = 6): Promise<Hit[]> {
  try {
    const db = await getPrisma();
    const rows = await db.rAGDocument.findMany();
    if (rows.length) {
      const docs: Doc[] = rows.map((r: any) => ({ sourceType: r.sourceType, sourceId: r.sourceId, title: r.title, content: r.content, metadata: r.metadata, embedding: Array.isArray(r.embedding) ? r.embedding : null }));
      if (embeddingsEnabled()) { const qv = await embedText(query); if (qv) { const sem = retrieveSemantic(qv, docs, k); if (sem.length) return sem; } }
      return retrieve(query, docs, k);
    }
  } catch { /* fall through */ }
  const docs = buildDocuments(await loadCatalog()) as Doc[];
  return retrieve(query, docs, k);
}
