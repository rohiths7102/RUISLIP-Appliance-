import { getPrisma } from "@/lib/prisma";
import { poaNamesFromDb } from "@/lib/poa";
import type { Doc, Hit } from "@/lib/rag/retriever";

/**
 * Structured product lookup for "have you got X under £Y" questions.
 *
 * Why this exists: the RAG index is BM25 over product documents, which has no
 * idea what a price is. Asked "washing machines under 500" it scored the words
 * "washing"/"machine" and returned Bosch SPARE PART documents — so the model was
 * handed a context containing no washing machines and correctly answered "we
 * don't have any under £500". The shop has 51, from £239.99. A confidently wrong
 * "we don't stock that" is worse than no chatbot: it turns a buyer away.
 *
 * So when the question contains a price ceiling and/or a recognisable department,
 * we ask the DATABASE the question directly and hand those rows to the model
 * alongside the keyword hits. Cheapest-first, because that is what "under £X"
 * is really asking.
 *
 * Deliberately conservative: no price cap and no category match => no rows, and
 * the normal keyword path is unchanged.
 */

/** "under £500", "below 400", "less than £1,000", "up to 750", "£500 budget" */
export function parsePriceCap(q: string): number | null {
  const s = q.toLowerCase().replace(/,/g, "");
  const m =
    s.match(/(?:under|below|less than|cheaper than|max|maximum|up to|within|no more than)\s*£?\s*(\d{2,6})/) ||
    s.match(/£\s*(\d{2,6})\s*(?:or less|budget|max)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 20 && n <= 100000 ? n : null;
}

/**
 * Map everyday wording to the catalogue's own subcategory/category names.
 * Longest phrases first so "washer dryer" is not eaten by "washer".
 */
const TERMS: [RegExp, string][] = [
  [/\bwasher[- ]?dryers?\b/, "Washer Dryers"],
  [/\bwashing machines?\b|\bwashers?\b/, "Washing Machines"],
  [/\btumble dryers?\b|\bdryers?\b/, "Tumble Dryers"],
  [/\bfridge[- ]?freezers?\b/, "Fridge Freezers"],
  [/\bfreezers?\b/, "Freezers"],
  [/\bfridges?\b|\brefrigerators?\b/, "Fridges"],
  [/\bdishwashers?\b/, "Dishwashers"],
  [/\bovens?\b|\bcookers?\b/, "Ovens"],
  [/\bhobs?\b|\bcooktops?\b/, "Hobs"],
  [/\bmicrowaves?\b/, "Microwaves"],
  [/\b(cooker )?hoods?\b|\bextractors?\b/, "Cooker Hoods & Extractors"],
  [/\btvs?\b|\btelevisions?\b/, "Televisions"],
  [/\bsoundbars?\b|\bspeakers?\b/, "Soundbars & Speakers"],
  [/\bvacuums?\b|\bhoovers?\b/, "Vacuum Cleaners"],
  [/\bcoffee machines?\b/, "Coffee Machines"],
];

export function parseCategory(q: string): string | null {
  const s = q.toLowerCase();
  for (const [re, name] of TERMS) if (re.test(s)) return name;
  return null;
}

/**
 * Brands the shop actually stocks. Without this a question naming a brand was
 * answered from the whole category: "do you sell neff ovens?" returned Bosch
 * ovens, and the model correctly reported that it could see no Neff — while 17
 * Neff ovens sat in the catalogue. Denying stock you hold is the worst answer
 * this assistant can give, so the brand is now part of the query.
 */
const BRANDS = [
  "Bosch", "Neff", "Siemens", "Smeg", "AEG", "Beko", "Blomberg", "Samsung", "LG",
  "Hotpoint", "Hisense", "Miele", "Liebherr", "Haier", "Sony", "Caple", "Zanussi",
  "Indesit", "Candy", "Hoover", "Sharp", "Whirlpool", "Rangemaster", "Quooker",
  "Fisher & Paykel", "Dyson", "Shark", "Ninja", "CDA", "Elica", "Stoves",
];

export function parseBrand(q: string): string | null {
  // Word-boundary match on a normalised string; no regex is built from the
  // brand text itself, so "Fisher & Paykel" needs no escaping.
  const words = new Set(q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" "));
  for (const b of BRANDS) {
    const parts = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
    if (parts.every((w) => words.has(w))) return b;
  }
  return null;
}

/** Products matching the question's category and price ceiling, cheapest first. */
export async function shortlistHits(query: string, take = 6): Promise<Hit[]> {
  const cap = parsePriceCap(query);
  const category = parseCategory(query);
  const brand = parseBrand(query);
  if (cap === null && !category && !brand) return [];

  const db = await getPrisma();
  // Never surface a call-for-price line with a number attached — same rule the
  // storefront and the merchant feed follow.
  const poa = [...(await poaNamesFromDb(db))];

  const rows = await db.product.findMany({
    where: {
      isVisible: true,
      priceNow: cap === null ? { gt: 0 } : { gt: 0, lte: cap },
      ...(category ? { OR: [{ subcategory: category }, { category: category }] } : {}),
      ...(brand ? { brand: { equals: brand } } : {}),
      ...(poa.length ? { NOT: [{ category: { in: poa } }, { subcategory: { in: poa } }] } : {}),
    },
    select: {
      slug: true, title: true, brand: true, productCode: true, priceNow: true,
      subcategory: true, category: true, availabilityRaw: true, warranty: true,
    },
    // "under £X" means "show me the affordable ones", so ascending — not the
    // dearest six, which is what an unordered take would drift toward.
    orderBy: [{ priceNow: "asc" }],
    take,
  });

  return rows.map((p: any, i: number): Hit => {
    const doc: Doc = {
      sourceType: "product",
      sourceId: p.slug,
      title: `${p.brand} ${p.title}`.trim(),
      content: [
        `${p.brand} ${p.title}`.trim(),
        `Product code: ${p.productCode}`,
        `Price: £${Number(p.priceNow).toFixed(2)}`,
        `Category: ${p.subcategory || p.category}`,
        p.availabilityRaw ? `Availability (confirm by phone): ${p.availabilityRaw}` : "",
        p.warranty ? `Warranty: ${p.warranty}` : "",
      ].filter(Boolean).join("\n"),
      metadata: { url: `/products/${p.slug}`, productCode: p.productCode },
    };
    // Above any BM25 score so these lead the context block; descending so the
    // cheapest stays first after the caller sorts.
    return { doc, score: 1000 - i };
  });
}
