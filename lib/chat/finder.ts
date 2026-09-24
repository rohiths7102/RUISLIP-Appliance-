import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import { buildDocuments } from "@/lib/rag/documents";
import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { parseCategory, parsePriceCap } from "@/lib/chat/shortlist";
import { lexIndex, lexSearch, slips, tokens, type Lex } from "@/lib/rag/retriever";
import type { ChatMsg } from "@/lib/chat/groq";

/**
 * The chatbot's finder: what the customer asked for, found in the LIVE catalogue.
 *
 * Two kinds of intelligence, each doing the part it is good at. This file is
 * the exact half: model codes (typed whole, in part, with spaces, or one
 * character off), brand (typos too), department, budget, and a typo-tolerant
 * keyword search. The language model only writes the reply, from the facts
 * found here. Every price, warranty and link it may quote is read from the
 * product table at question time, so the nightly Euronics price sync is in the
 * very next answer. The search index (RAGDocument) is used to FIND products,
 * never to quote them — its copy of a price is whatever it was at the last build.
 */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ------------------------------------------------ the catalogue, cached */

type Row = { productCode: string; title: string; brand: string; category: string; subcategory: string };
type Knowledge = { title: string; content: string; url: string };
type Catalogue = {
  rows: Row[];                          // visible products (a code can be listed twice: Bosch/Neff twins)
  codes: { code: string; sq: string }[]; // codes worth matching inside a sentence
  titles: string[];                      // squashed product names: "Series 6" is a name, not a missing code
  brands: string[];
  prodCodes: string[];                   // keyword-index documents 0..n-1, by code
  know: Knowledge[];                     // then shop info: hours, delivery, how to buy, brands, departments
  // One index for both, so the best match says what a question is about: the
  // opening-hours page outranks a "side opening" oven for "when do you open?".
  ix: Lex;
};

// Five minutes per server instance: a product added or renamed is findable
// within five minutes. Facts are never cached — they are read per question.
const TTL = 5 * 60_000;
let cached: { at: number; p: Promise<Catalogue> } | null = null;

function catalogue(): Promise<Catalogue> {
  if (!cached || Date.now() - cached.at > TTL) {
    const p = loadCatalogue();
    p.catch(() => { if (cached?.p === p) cached = null; });
    cached = { at: Date.now(), p };
  }
  return cached.p;
}

async function loadCatalogue(): Promise<Catalogue> {
  const db = await getPrisma();
  const [rows, docs] = await Promise.all([
    db.product.findMany({ where: { isVisible: true }, select: { productCode: true, title: true, brand: true, category: true, subcategory: true } }) as Promise<Row[]>,
    db.rAGDocument.findMany({ select: { sourceType: true, sourceId: true, title: true, content: true, metadata: true } }).catch(() => [] as any[]),
  ]);
  // No index built yet: the same documents, straight from the catalogue.
  const all: any[] = docs.length ? docs : buildDocuments(await loadCatalog());
  const docText = new Map<string, string>();
  const know: Knowledge[] = [];
  for (const d of all) {
    if (d.sourceType === "product") docText.set(d.sourceId, `${d.title} ${d.title} ${d.title} ${d.content}`);
    else know.push({ title: d.title, content: d.content, url: d.metadata?.url || "" });
  }
  const byCode = new Map(rows.map((r) => [r.productCode, r]));
  const prodCodes = [...byCode.keys()];
  return {
    rows,
    // A code needs a digit and five characters to be looked for inside a
    // sentence; shorter or all-letter ones would match ordinary words.
    codes: prodCodes.map((code) => ({ code, sq: squash(code) })).filter((c) => c.sq.length >= 5 && /\d/.test(c.sq)),
    titles: rows.map((r) => squash(r.title)),
    brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))],
    prodCodes,
    know,
    ix: lexIndex([
      // A product the index hasn't met yet (added since the last build) is still
      // searchable by its name.
      ...prodCodes.map((c) => { const r = byCode.get(c)!; return docText.get(c) ?? `${r.title} ${r.title} ${r.title} ${r.brand} ${r.subcategory} ${r.category} ${c}`; }),
      ...know.map((k) => `${k.title} ${k.title} ${k.content}`),
    ]),
  };
}

/* ------------------------------------------------ understanding the question */

const STOP = new Set(("a an the and or of for to in on at by with from is are was be been do does did you your we our us i me my it its this that " +
  "these those there here have has had got get any some can could would should will what whats how when where why which who much many please pls " +
  "thanks thank hi hello hey just also still one ones them they if so not no yes ok okay am im id ive dont want need looking like show tell about").split(" "));

// Misspellings too short for the one-slip rule below (which needs six letters,
// or "cable" would read as Caple and "mile" as Miele).
const BRAND_ALIASES: Record<string, string> = { bosh: "Bosch", bosche: "Bosch", boch: "Bosch", meile: "Miele", mielle: "Miele" };

function brandIn(text: string, brands: string[]): string | null {
  const ws = tokens(text);
  const set = new Set(ws);
  const longest = [...brands].sort((a, b) => b.length - a.length);
  for (const b of longest) { const parts = tokens(b); if (parts.length && parts.every((p) => set.has(p))) return b; }
  for (const w of ws) { const a = BRAND_ALIASES[w]; if (a && brands.includes(a)) return a; }
  for (const w of ws) {
    if (w.length < 6) continue;
    for (const b of longest) { const n = squash(b); if (n.length >= 6 && slips(w, n) <= 1) return b; }
  }
  return null;
}

// Department words, so one typo ("dishwaser", "washng machine", "frige") still
// finds the department. Five letters or more: shorter words have too many neighbours.
const DEPARTMENT_WORDS = ("washing machine machines washer washers dryer dryers tumble fridge fridges freezer freezers american " +
  "refrigerator dishwasher dishwashers integrated freestanding cooker cookers oven ovens microwave microwaves extractor extractors " +
  "television televisions soundbar soundbars speaker speakers vacuum vacuums hoover hoovers cordless robot coffee espresso " +
  "kettle kettles toaster toasters sinks boiling quooker cooler coolers warming drawer drawers fryer fryers").split(" ");

function departmentIn(text: string): string | null {
  const direct = parseCategory(text);
  if (direct) return direct;
  return parseCategory(text.toLowerCase().replace(/[a-z]{5,}/g, (w) =>
    DEPARTMENT_WORDS.includes(w) ? w : DEPARTMENT_WORDS.find((d) => slips(w, d) <= 1) || w));
}

/** "over £500", "between £300 and £500" — the floor; parsePriceCap owns the ceiling. */
function priceRange(text: string): { min: number | null; max: number | null } {
  const s = text.toLowerCase().replace(/,/g, "");
  const between = s.match(/between\s*£?\s*(\d{2,6})\s*(?:and|-|to)\s*£?\s*(\d{2,6})/);
  if (between) return { min: Math.min(+between[1], +between[2]), max: Math.max(+between[1], +between[2]) };
  const over = s.match(/(?:over|above|more than|at least|starting at)\s*£\s*(\d{2,6})/);
  return { min: over ? +over[1] : null, max: parsePriceCap(text) };
}

const sortIn = (text: string): "asc" | "desc" | null =>
  /\b(cheap|cheapest|cheaper|lowest price|budget|affordable|entry[- ]level|least expensive)\b/i.test(text) ? "asc"
    : /\b(most expensive|premium|top of the range|high[- ]end|luxury|flagship)\b/i.test(text) ? "desc" : null;

// Words that point back at the conversation ("any cheaper ones?", "what about Bosch?").
const REFERS_BACK = /\b(it|that|those|these|them|ones?|which|cheaper|dearer|bigger|smaller|other|another|else|instead|what about|how about|any more)\b/i;

const ACCESSORY = /\b(bags?|filters?|pods|packs?|spares?|replacement|accessor(?:y|ies)|kits?|cartridges?|descaler|solution|adaptors?|adapters?|hoses?|brush(?:es)?|nozzles?|belts?|batter(?:y|ies))\b/i;

// Units and ordinals that look like codes but aren't: 1400rpm, 65inch, 10kg, 2nd.
const NOT_A_CODE = /^\d+-?[a-z]{2,}$/;

/** Things in the question shaped like a model code: letters and digits, five characters or more. */
function askedCodes(text: string): string[] {
  const found = (text.match(/[a-z0-9][a-z0-9\-/.]{3,}[a-z0-9]/gi) || [])
    .filter((t) => /\d/.test(t) && /[a-z]/i.test(t) && squash(t).length >= 5 && !NOT_A_CODE.test(t.toLowerCase()));
  return [...new Set(found.map((t) => t.toUpperCase()))];
}

/** Catalogue codes written anywhere in a text (with or without its spaces and dashes), longest first. */
function codesIn(text: string, codes: Catalogue["codes"]): string[] {
  const sq = squash(text);
  const hit = codes.filter((c) => sq.includes(c.sq));
  // "EY48SB880" also contains the code "EY48SB8" if both exist: keep the longer.
  return hit.filter((c) => !hit.some((o) => o !== c && o.sq.length > c.sq.length && o.sq.includes(c.sq)))
    .sort((a, b) => sq.indexOf(a.sq) - sq.indexOf(b.sq)).map((c) => c.code);
}

export type CodeCheck = { asked: string; status: "exact" | "partial" | "near" | "none"; codes: string[] };

/* ------------------------------------------------ facts */

export type Fact = {
  code: string; name: string; brand: string; department: string;
  price: number | null; was: number | null; saving: number | null; callForPrice: boolean;
  availability: string; warranty: string; url: string; specs: string; about: string; why: string;
};
export type Found = {
  understood: { brand: string | null; category: string | null; minPrice: number | null; maxPrice: number | null; carriedOver: boolean };
  codes: CodeCheck[];
  products: Fact[];
  range: { label: string; count: number; min: number | null; max: number | null; note: string } | null;
  knowledge: Knowledge[];
  /** The question had something to look for (not just "hi"). */
  searched: boolean;
};

const money = (n: number) => `£${n.toFixed(2)}`;

export async function findForChat(history: ChatMsg[], question: string): Promise<Found> {
  const cat = await catalogue();
  const db = await getPrisma();
  const users = history.filter((m) => m.role === "user").map((m) => m.content);
  const previous = users.length > 1 ? users[users.length - 2] : "";
  const lastReply = [...history].reverse().find((m) => m.role === "assistant")?.content || "";

  // --- codes
  const exact = codesIn(question, cat.codes);
  const checks: CodeCheck[] = [];
  const partial: string[] = [], near: string[] = [];
  // An email address or a link is not a model code.
  for (const asked of askedCodes(question.replace(/\S+@\S+|https?:\/\/\S+/g, " "))) {
    const a = squash(asked);
    const whole = exact.filter((c) => squash(c).includes(a) || a.includes(squash(c)));
    if (whole.length) { checks.push({ asked, status: "exact", codes: whole }); continue; }
    // Typed in part: "WGG254" is the start (or the middle) of the full code.
    const starts = cat.codes.filter((c) => c.sq.startsWith(a)).map((c) => c.code);
    const inside = starts.length ? starts : cat.codes.filter((c) => c.sq.includes(a)).map((c) => c.code);
    if (inside.length) { checks.push({ asked, status: "partial", codes: inside.slice(0, 3) }); partial.push(...inside.slice(0, 3)); continue; }
    if (cat.titles.some((t) => t.includes(a))) continue; // part of a product's name, e.g. "Series 6", "OLED55": the keyword search has it
    // Not listed: the closest codes by shared beginning — usually the same model
    // in another colour or year (WGG254Z0GB → WGG254Z1GB).
    const shared = (c: string) => { let i = 0; while (i < a.length && i < c.length && a[i] === c[i]) i++; return i; };
    const close = cat.codes.map((c) => ({ code: c.code, n: shared(c.sq), gap: Math.abs(c.sq.length - a.length) }))
      .filter((c) => c.n >= 4 && c.n >= a.length / 2).sort((x, y) => y.n - x.n || x.gap - y.gap).slice(0, 3).map((c) => c.code);
    checks.push({ asked, status: close.length ? "near" : "none", codes: close });
    near.push(...close);
  }

  // --- brand, department, budget — carried over from the last question when this one points back at it
  let brand = brandIn(question, cat.brands);
  let category = departmentIn(question);
  if (category && !cat.rows.some((r) => r.subcategory === category || r.category === category)) category = null;
  let { min, max } = priceRange(question);
  let sort = sortIn(question);
  const ownSignal = !!(brand || category || min != null || max != null || exact.length || checks.length);
  let carriedOver = false;
  if (previous && !category && !exact.length && !checks.length && (brand || min != null || max != null || sort || REFERS_BACK.test(question))) {
    const pc = departmentIn(previous);
    if (pc) {
      category = pc; carriedOver = true;
      if (!brand) brand = brandIn(previous, cat.brands);
      if (min == null && max == null) ({ min, max } = priceRange(previous));
      sort ??= sortIn(previous);
    }
  }
  // "Hoover" is also the everyday word for a vacuum cleaner.
  if (brand === "Hoover" && category && /vacuum/i.test(category)) brand = null;

  // --- the shelf: brand/department/budget, straight from the product table.
  // One thin query per shelf, sorted and counted here, because the catalogue
  // files bags, filters and cleaning solution among the vacuums: cheapest-first
  // led "hoovers under £200" with £12.99 bags, and "from £12.99" with them.
  // Accessories are left out unless the question asks for them.
  const poaSet = await poaNamesFromDb(db);
  let range: Found["range"] = null;
  let listed: string[] = [];
  // A code with only a brand beside it ("the Bosch WGG254Z0GB") is about that code, not the Bosch range.
  if (category || min != null || max != null || (brand && !checks.length && !exact.length)) {
    const priceOf = (r: any): number | null => (r.priceNow > 0 && !isPoaProduct(poaSet, r) ? r.priceNow : null); // call-for-price: never a number, not even "from £X"
    const byPrice = (x: any, y: any) => (priceOf(x) ?? Infinity) - (priceOf(y) ?? Infinity);
    const order = sort === "desc" ? (x: any, y: any) => (priceOf(y) ?? -1) - (priceOf(x) ?? -1)
      : sort === "asc" || max != null ? byPrice : (x: any, y: any) => Number(y.featured) - Number(x.featured) || byPrice(x, y);
    const shelf = async (b: string | null, lo: number | null, hi: number | null) => {
      const rows: any[] = await db.product.findMany({
        where: { isVisible: true, ...(category && { OR: [{ subcategory: category }, { category: category }] }), ...(b && { brand: b }) },
        select: { productCode: true, title: true, brand: true, category: true, subcategory: true, priceNow: true, featured: true },
      });
      const unique = [...new Map(rows.map((r) => [r.productCode, r])).values()]; // Bosch/Neff twins share a code
      const appliances = ACCESSORY.test(question) ? unique : unique.filter((r) => !ACCESSORY.test(r.title));
      const pool = (appliances.length ? appliances : unique)
        .filter((r) => (lo == null && hi == null) || (priceOf(r) != null && (lo == null || priceOf(r)! >= lo) && (hi == null || priceOf(r)! <= hi)));
      const prices = pool.map(priceOf).filter((n): n is number => n != null);
      return {
        codes: [...pool].sort(order).slice(0, 5).map((r) => r.productCode as string), count: pool.length,
        min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
      };
    };
    const what = [brand, category || "products"].filter(Boolean).join(" ");
    const budget = max != null && min != null ? ` between ${money(min)} and ${money(max)}` : max != null ? ` under ${money(max)}` : min != null ? ` over ${money(min)}` : "";
    let s = await shelf(brand, min, max), note = "";
    // Never answer "we don't have that" from one narrow query: widen, and say how.
    if (!s.count && brand && category) { note = `No ${what}${budget} is listed; these are other brands.`; s = await shelf(null, min, max); }
    if (!s.count && (min != null || max != null)) {
      const any = await shelf(note ? null : brand, null, null);
      if (any.count) { note = `Nothing${budget} is listed; the cheapest ${category || "match"} is ${any.min != null ? money(any.min) : "priced by phone"}.`; s = any; }
    }
    if (s.count) range = { label: `${what}${note ? "" : budget}`, count: s.count, min: s.min, max: s.max, note };
    listed = s.codes;
  }

  // --- keyword search over products and shop info together. Held to the brand
  // and department asked about, so "any Bosch ones?" doesn't add a Bosch hood
  // filter; and when the best match is shop information and the question named
  // no product, it adds no products at all ("when do you open on Saturday?").
  const terms = tokens(question).filter((w) => !STOP.has(w));
  const P = cat.prodCodes.length;
  const hits = lexSearch(cat.ix, terms, 80);
  const rowOf = new Map(cat.rows.map((r) => [r.productCode, r]));
  const fits = (r: Row) => (!brand || r.brand === brand) && (!category || r.subcategory === category || r.category === category);
  const productHits = hits[0] && (hits[0].i < P || ownSignal)
    ? hits.filter((h) => h.i < P).map((h) => rowOf.get(cat.prodCodes[h.i])!).filter(fits) : [];
  // A question about a code ("price of the Bosch WGG254Z0GB?") is answered by
  // that code and its neighbours; the brand word alone would add any Bosch part.
  const codeWords = new Set([...checks.map((c) => squash(c.asked)), ...exact.map(squash), ...(brand ? tokens(brand) : []), "price", "prices", "cost", "stock", "buy"]);
  const aboutMore = !(checks.length || exact.length) || terms.some((t) => !codeWords.has(t));
  const keywordHits = aboutMore ? productHits.slice(0, 5).map((r) => r.productCode) : [];
  const shopHits = hits.filter((h) => h.i >= P);
  const knowledge = shopHits.filter((h) => h.score >= Math.max(1, shopHits[0].score * 0.5)).slice(0, 3).map((h) => cat.know[h.i - P]);

  // Products the assistant named last turn, so "is the second one quieter?" has the facts.
  const earlier = lastReply ? codesIn(lastReply, cat.codes).slice(0, 4) : [];

  // --- pick, in order of how sure we are; six at most
  const why = new Map<string, string>();
  const add = (codes: string[], reason: (c: string) => string) => { for (const c of codes) if (!why.has(c) && why.size < 6) why.set(c, reason(c)); };
  add(exact, () => "exact code match");
  for (const c of checks) if (c.status === "partial") add(c.codes, () => `code starts with or contains "${c.asked}"`);
  for (const c of checks) if (c.status === "near") add(c.codes, () => `closest listed code to "${c.asked}"`);
  if (!ownSignal && REFERS_BACK.test(question)) add(earlier, () => "named earlier in this chat");
  add(listed, () => (range?.note ? "nearest alternative" : "matches the brand/department/budget asked"));
  add(keywordHits, () => "keyword match");
  add(earlier, () => "named earlier in this chat");

  // --- facts, live
  const live = why.size ? await db.product.findMany({
    where: { productCode: { in: [...why.keys()] }, isVisible: true },
    select: { productCode: true, title: true, brand: true, category: true, subcategory: true, priceNow: true, priceWas: true, saving: true,
      availabilityRaw: true, warranty: true, slug: true, specifications: true, shortDescription: true },
  }) : [];
  const products: Fact[] = [];
  for (const [code, reason] of why) {
    const twins = live.filter((r: any) => r.productCode === code);
    const r: any = twins.find((t: any) => t.brand === brand) || twins[0];
    if (!r) continue;
    const hidePrice = isPoaProduct(poaSet, r);
    const specs = (Array.isArray(r.specifications) ? r.specifications : []).slice(0, 8)
      .map((s: any) => `${s.label}: ${String(s.value).slice(0, 80)}`).join("; ");
    products.push({
      code, name: r.title, brand: r.brand, department: r.subcategory || r.category,
      price: hidePrice ? null : r.priceNow, was: hidePrice ? null : r.priceWas, saving: hidePrice ? null : r.saving, callForPrice: hidePrice,
      availability: r.availabilityRaw || "", warranty: r.warranty || "", url: `/products/${r.slug}`,
      specs: specs.slice(0, 600), about: String(r.shortDescription || "").slice(0, 240), why: reason,
    });
  }

  return {
    understood: { brand, category, minPrice: min, maxPrice: max, carriedOver },
    codes: checks, products, range, knowledge,
    searched: terms.length > 0 || checks.length > 0 || !!(brand || category),
  };
}

/**
 * What a drafted reply says that its facts don't: a catalogue code that wasn't
 * in them, or a £ amount matching no price given (rounding to the pound is
 * allowed). Empty means safe to send. Deterministic — the model is not asked to
 * mark its own homework.
 */
export async function checkReply(reply: string, f: Found, question: string): Promise<string[]> {
  const cat = await catalogue();
  const given = [...f.products.map((p) => p.code), ...f.codes.flatMap((c) => c.codes)].map(squash);
  const problems = codesIn(reply, cat.codes).filter((c) => !given.some((g) => g.includes(squash(c)))).map((c) => `the code ${c}`);
  const nums = (s: string) => (s.replace(/,/g, "").match(/(?<![a-z0-9.])\d+(?:\.\d+)?(?![a-z0-9])/gi) || []).map(Number);
  const allowed = [
    ...f.products.flatMap((p) => [p.price, p.was, p.saving, p.was != null && p.price != null ? p.was - p.price : null]),
    f.range?.min, f.range?.max, ...nums(question), ...f.knowledge.flatMap((k) => nums(k.content)),
  ].filter((n): n is number => typeof n === "number");
  for (const m of reply.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
    const amount = Number(m[1].replace(/,/g, "") + (m[2] ? `.${m[2]}` : ""));
    if (!allowed.some((x) => Math.abs(x - amount) < 1)) problems.push(`the price ${m[0].replace(/\s/g, "")}`);
  }
  return [...new Set(problems)];
}
