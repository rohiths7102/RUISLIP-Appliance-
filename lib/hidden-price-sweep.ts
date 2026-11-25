import { POA_PAIR_WHERE } from "@/lib/select";
import { productDoc } from "@/lib/rag/documents";
import { docId } from "@/lib/rag/index";
import { embeddingsEnabled } from "@/lib/rag/embed";

/** True when `text` states `price` as a pound amount ("£24.9", "£24.90", "£1,024.90"). */
export const quotesPrice = (text: string, price: number) =>
  [...text.matchAll(/£\s?(\d[\d,]*(?:\.\d+)?)/g)].some((m) => Math.abs(Number(m[1].replace(/,/g, "")) - price) < 0.005);

/**
 * Daily: nothing stored may still carry a price the brand + category rule hides
 * (lib/select POA_BRAND_CATEGORY). That rule changes in code, so unlike a ticked
 * category or brand no admin action re-syncs what was written before it:
 *   - the chatbot index document of each such product is rewritten without its price;
 *   - an unsent AI reply draft that quotes a price the product has had, on the shop
 *     or on a checked site, is cleared, so the owner drafts again and types his own.
 *     A draft with any other figure (his own quote) is left alone.
 */
export async function sweepHiddenPrices(db: any): Promise<{ docs: number; drafts: number; note: string }> {
  const rows: any[] = await db.product.findMany({ where: { isVisible: true, OR: POA_PAIR_WHERE } });
  let docs = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const want = rows.slice(i, i + 250).map((r) => {
      const d = productDoc({ title: r.title, productCode: r.productCode, brand: r.brand, category: r.category, subcategory: r.subcategory, priceNow: r.priceNow, priceWas: r.priceWas, saving: r.saving, warranty: r.warranty, shortDescription: r.shortDescription, specifications: r.specifications || [], features: r.features || [], image: r.mainImage, newSlug: `/products/${r.slug}` } as any, { omitPrice: true });
      return { id: docId(d.sourceType, d.sourceId), d };
    });
    const have: any[] = await db.rAGDocument.findMany({ where: { id: { in: want.map((w) => w.id) } }, select: { id: true, content: true } });
    const stale = want.filter((w) => { const h = have.find((x) => x.id === w.id); return h && h.content !== w.d.content; });
    if (stale.length) await db.$transaction(stale.map((w) => db.rAGDocument.update({ where: { id: w.id }, data: { title: w.d.title, content: w.d.content, metadata: w.d.metadata, needsReindex: embeddingsEnabled() } })));
    docs += stale.length;
  }
  // Every figure the shop or a checked site has had for the product, not only today's:
  // a draft written last week quotes the price of that day.
  const codeOf = new Map<string, string>(rows.map((r) => [r.id, r.productCode]));
  const pricesOf = new Map<string, number[]>();
  const add = (code: string | undefined, n: unknown) => { if (code && typeof n === "number") pricesOf.set(code, [...(pricesOf.get(code) || []), n]); };
  for (const r of rows) { add(r.productCode, r.priceNow); add(r.productCode, r.priceWas); }
  const ids = [...codeOf.keys()];
  const [seen, mapped]: any[][] = await Promise.all([
    db.priceObservation.findMany({ where: { productId: { in: ids }, price: { not: null } }, distinct: ["productId", "price"], select: { productId: true, price: true } }),
    db.brandPriceItem.findMany({ where: { productId: { in: ids } }, select: { productId: true, price: true } }),
  ]);
  for (const o of [...seen, ...mapped]) add(codeOf.get(o.productId), o.price);
  const leads: any[] = pricesOf.size ? await db.enquiry.findMany({ where: { lastEmailedAt: null, aiDraftBody: { not: "" }, productCode: { in: [...pricesOf.keys()] } }, select: { id: true, productCode: true, aiDraftSubject: true, aiDraftBody: true } }) : [];
  const quoting = leads.filter((l) => pricesOf.get(l.productCode)!.some((n) => quotesPrice(`${l.aiDraftSubject} ${l.aiDraftBody}`, n)));
  if (quoting.length) await db.enquiry.updateMany({ where: { id: { in: quoting.map((l) => l.id) } }, data: { aiDraftSubject: "", aiDraftBody: "" } });
  return { docs, drafts: quoting.length, note: `${docs} chatbot documents rewritten without a price, ${quoting.length} reply drafts quoting a withheld price cleared` };
}
