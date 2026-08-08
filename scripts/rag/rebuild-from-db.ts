/**
 * Rebuild the chatbot's retrieval index from whatever database DATABASE_URL
 * points at — used to refresh PRODUCTION after a catalogue import, where the
 * usual `npm run rag:build` cannot reach (it reads through loadCatalog, which is
 * bound to the local sqlite client).
 *
 *   PRISMA_CLIENT_DIR=…/pg/client node scripts/db/with-prod-db.mjs scripts/rag/rebuild-from-db.ts
 *
 * Builds the exact same documents the app's buildDocuments() produces — one
 * definition of "which categories are call-for-price", so the bot can never be
 * the surface that quotes a withheld price — then upserts them and prunes the
 * docs of products and brands that are no longer live.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");
import { buildDocuments } from "../../lib/rag/documents.js";
import { embedText, embeddingsEnabled } from "../../lib/rag/embed.js";

const arr = (v: any): any[] => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } })() : []);

const db = new PrismaClient();
try {
  const [prod, cats, brds, biz, svcs] = await Promise.all([
    db.product.findMany({ where: { isVisible: true } }),
    db.category.findMany(),
    db.brand.findMany({ where: { isVisible: true } }),
    db.businessInfo.findUnique({ where: { id: "business" } }),
    db.serviceAddOn.findMany(),
  ]);

  const catalog = {
    products: prod.map((r: any) => ({
      id: r.id, newSlug: `/products/${r.slug}`, title: r.title, brand: r.brand, productCode: r.productCode,
      category: r.category, subcategory: r.subcategory, priceNow: r.priceNow, priceWas: r.priceWas, saving: r.saving,
      warranty: r.warranty, shortDescription: r.shortDescription, specifications: arr(r.specifications),
      features: arr(r.features), image: r.mainImage,
    })),
    categories: cats.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug, parentCategory: c.parentId || "",
      description: c.description, productCount: c.productCount, priceOnApplication: !!c.priceOnApplication })),
    brands: brds.map((b: any) => ({ id: b.id, name: b.name, slug: b.slug })),
    business: biz ? { businessName: biz.businessName, tradingName: biz.tradingName, phone: biz.phone, email: biz.email,
      address: biz.address, openingHours: biz.openingHours,
      delivery: { radius: biz.deliveryRadius, notes: biz.deliveryNotes, timescale: "" }, socialLinks: biz.socialLinks,
      mapQuery: biz.mapQuery, googleMapsEmbedUrl: biz.googleMapsEmbedUrl, googleMapsDirectionsUrl: biz.googleMapsDirectionsUrl } : null,
    services: svcs.map((s: any) => ({ id: s.id, name: s.name, description: s.description, price: s.price, optional: s.optional, category: s.appliesToCategory || "delivery" })),
  } as any;

  if (!catalog.business) { console.error("✗ no BusinessInfo row — cannot build business/faq docs"); process.exit(1); }

  const docs = buildDocuments(catalog);
  const useEmbeddings = embeddingsEnabled();
  console.log(`building ${docs.length} docs from the live database (${useEmbeddings ? "with embeddings" : "lexical mode"})…`);

  let done = 0;
  for (const d of docs) {
    const id = `${d.sourceType}:${d.sourceId}`;
    let embedding: number[] = [];
    if (useEmbeddings) { const v = await embedText(`${d.title}. ${d.content}`); if (v) embedding = v; }
    await db.rAGDocument.upsert({
      where: { id },
      update: { title: d.title, content: d.content, metadata: d.metadata, embedding, needsReindex: false },
      create: { id, sourceType: d.sourceType, sourceId: d.sourceId, title: d.title, content: d.content, metadata: d.metadata, embedding },
    });
    if (++done % 250 === 0) console.log(`  upserted ${done}/${docs.length}`);
  }

  // Prune docs the catalogue no longer backs: products now hidden or gone, and the
  // brand rows merged away in the repair (Fisher/Russell/NUTRIBULLET).
  const liveProduct = new Set(catalog.products.map((p: any) => p.productCode));
  const liveBrand = new Set(catalog.brands.map((b: any) => b.id));
  const staleProducts = await db.rAGDocument.findMany({ where: { sourceType: "product" }, select: { sourceId: true } });
  const staleBrands = await db.rAGDocument.findMany({ where: { sourceType: "brand" }, select: { sourceId: true } });
  const killP = staleProducts.filter((r: any) => !liveProduct.has(r.sourceId)).map((r: any) => r.sourceId);
  const killB = staleBrands.filter((r: any) => !liveBrand.has(r.sourceId)).map((r: any) => r.sourceId);
  if (killP.length) await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: { in: killP } } });
  if (killB.length) await db.rAGDocument.deleteMany({ where: { sourceType: "brand", sourceId: { in: killB } } });

  const total = await db.rAGDocument.count();
  console.log(`\ndone: ${docs.length} docs upserted, pruned ${killP.length} product + ${killB.length} brand docs. Index now holds ${total}.`);
} finally {
  await db.$disconnect();
}
