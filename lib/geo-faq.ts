import { callAssistant, groqConfigured } from "@/lib/chat/groq";
import { writeAudit } from "@/lib/audit";
import { poaNamesFromDb } from "@/lib/poa";
import { hidesPrice } from "@/lib/select";

/**
 * GEO: buyer questions and answers on the product pages people look at most,
 * so Google's AI answers, ChatGPT and Perplexity have plain facts to quote and
 * a page to link. The AI writes from the product's own specification and the
 * shop's own terms only; a check refuses any answer with a price (prices change
 * nightly, this text doesn't) or "free" (delivery and fitting are paid). A few a
 * day, busiest pages of appliances £100 or more first, each rewritten after 90 days.
 */
const DAY = 86_400_000;
export const FAQ_PER_DAY = 3;
const REFRESH_DAYS = 90;

export type Faq = { q: string; a: string };

export function faqOk(items: unknown): items is Faq[] {
  if (!Array.isArray(items) || items.length < 3 || items.length > 5) return false;
  return items.every((x: any) =>
    x && typeof x.q === "string" && typeof x.a === "string" &&
    x.q.trim().length >= 10 && x.q.trim().length <= 120 && x.q.trim().endsWith("?") &&
    x.a.trim().length >= 30 && x.a.trim().length <= 420 &&
    !/£\s?\d|\d\s?(pounds|gbp)\b/i.test(x.q + " " + x.a) && !/\bfree\b/i.test((x.q + " " + x.a).replace(/frost[\s-]free/gi, "")));
}

/** The first JSON array in the reply (the AI may wrap it in a code fence). */
export function parseFaq(text: string): Faq[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j) ? j.map((x: any) => ({ q: String(x?.q || "").trim(), a: String(x?.a || "").trim() })) : null;
  } catch { return null; }
}

/** What the AI may use: the page's own facts, trimmed so a FAQ costs about 1k tokens in. */
export function productFacts(p: { title: string; brand: string; productCode: string; category: string; subcategory: string; warranty?: string; shortDescription?: string; specifications?: any }, phone: string) {
  const specs = (Array.isArray(p.specifications) ? p.specifications : [])
    .filter((s: any) => s?.label && s?.value).slice(0, 30)
    .map((s: any) => `- ${String(s.label).slice(0, 60)}: ${String(s.value).slice(0, 80)}`).join("\n");
  return `Product: ${p.brand} ${p.productCode}, ${p.title}
Type: ${[p.category, p.subcategory].filter(Boolean).join(" > ")}
${p.warranty ? `Warranty: ${p.warranty}\n` : ""}${p.shortDescription ? `Summary: ${String(p.shortDescription).slice(0, 300)}\n` : ""}Specification:
${specs || "- (none listed)"}

The shop: Euronics Jyotsna Electrical, an independent shop in South Ruislip, West London (Euronics member since 1977). It delivers in its own van to local areas, can install the appliance and take the old one away for recycling (paid services). No online checkout: customers call ${phone} or visit to confirm stock, price and delivery.`;
}

const SYSTEM = `You write the "Questions buyers ask" section of an appliance product page. Write 4 questions a shopper would really ask about THIS model (size and fit, a key feature, running cost or noise, warranty, delivery or installation from this shop) with short factual answers.
Rules: use ONLY the facts given; if a fact isn't given, don't ask about it. For size, ask "What are its dimensions?" and give them; never invent a customer's measurements or say whether it fits a space. Never state a price or use the word "free" (except "frost free"). Answers 1–3 sentences, plain British English, mention the model code once somewhere.
Reply with ONLY a JSON array: [{"q":"…?","a":"…"}]`;

export async function writeFaq(db: any, productId: string, by: string) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, brand: true, productCode: true, category: true, subcategory: true, warranty: true, shortDescription: true, specifications: true } });
  if (!p) return null;
  const b = await db.businessInfo.findFirst({ select: { phone: true } }).catch(() => null);
  let items: Faq[] | null = null, provider = "";
  for (let i = 0; i < 2 && !faqOk(items); i++) {
    const r = await callAssistant([{ role: "system", content: SYSTEM }, { role: "user", content: productFacts(p, b?.phone || "020 8864 5763") }], { maxTokens: 700, timeoutMs: 30_000 }).catch(() => null);
    if (r) { items = parseFaq(r.text); provider = r.provider; }
  }
  if (!faqOk(items)) return null;
  await db.productFaq.upsert({ where: { productId }, create: { productId, items, provider }, update: { items, provider, writtenAt: new Date() } });
  await writeAudit(db, { entityType: "product", entityId: productId, action: "update", changedFields: ["buyerFaq"], previousValue: null, newValue: { buyerFaq: items, provider }, changedBy: by });
  return items;
}

/** Daily: the most-viewed priced product pages without a FAQ (or with one over 90 days old) get one. */
export async function runGeoAgent(db: any, opts: { perDay?: number; by?: string; budgetMs?: number } = {}) {
  if (!groqConfigured()) return { written: [] as string[], note: "skipped: no AI key set" };
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const views: any[] = await db.trackedEvent.groupBy({
    by: ["productSlug"], where: { type: { in: ["page_view", "call_click"] }, productSlug: { not: "" }, createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
    _count: { _all: true }, orderBy: { _count: { productSlug: "desc" } }, take: 200,
  });
  const poa = await poaNamesFromDb(db);
  const ps: any[] = await db.product.findMany({
    // Appliances, not £6 spares: £100 or more, as for the Shopping feed's "Promote" label.
    where: { slug: { in: views.map((v) => v.productSlug) }, isVisible: true, priceNow: { gte: 100 } },
    select: { id: true, slug: true, productCode: true, brand: true, category: true, subcategory: true, pricewire: true, buyerFaq: { select: { writtenAt: true } } },
  });
  const rank = new Map(views.map((v, i) => [v.productSlug, i]));
  const due = ps.filter((p) => !hidesPrice(poa, p) && (!p.buyerFaq || Date.now() - new Date(p.buyerFaq.writtenAt).getTime() > REFRESH_DAYS * DAY))
    .sort((a, b) => rank.get(a.slug)! - rank.get(b.slug)!);
  const written: string[] = [], skipped: string[] = [];
  for (const p of due) {
    if (written.length >= (opts.perDay ?? FAQ_PER_DAY) || Date.now() > deadline) break;
    (await writeFaq(db, p.id, opts.by || "geo agent (daily)")) ? written.push(p.productCode) : skipped.push(p.productCode);
  }
  return { written, skipped, note: `${written.length} buyer FAQs written${skipped.length ? `, ${skipped.length} skipped (failed the checks)` : ""}; ${due.length} pages waiting` };
}

/** FAQPage structured data for a product page. */
export const faqJsonLd = (items: Faq[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
});
