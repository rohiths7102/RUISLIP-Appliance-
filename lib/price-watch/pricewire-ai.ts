import Anthropic from "@anthropic-ai/sdk";
import { unzipSync, strFromU8 } from "fflate";
import { parsePriceList, readTable } from "@/lib/price-list";
import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { writeAudit } from "@/lib/audit";

/**
 * Pricewire AI: prices read out of any document the owner uploads, and a review
 * queue for every price an AI has suggested.
 *
 * Nothing here changes a price. A document's prices, and the assistant's
 * suggestions (lib/price-watch/pricewire-agent.ts), become PriceObservations
 * from their own advisory sources ("ai-import", "ai-assistant"). The owner
 * applies them through the price-watch apply route, which re-reads the product,
 * converts VAT, runs every guard that also stops a human (below cost, call for
 * price, bad VAT basis…), locks the field and writes the audit — the same path
 * as any other price the owner accepts.
 *
 * Spreadsheets in the CIH layout are read by lib/price-list.ts without the AI
 * (exact, free). Everything else — PDFs, photos, Word files, other spreadsheets
 * — goes to Claude Haiku with a JSON schema for the rows. Only customer
 * (retail) prices are staged: a trade or cost price is never offered as a
 * selling price.
 */

export const AI_MODEL = "claude-haiku-5-5";
export const AI_SOURCES = ["ai-import", "ai-assistant"] as const;
export type AiSourceId = (typeof AI_SOURCES)[number];
const SOURCE_LABELS: Record<AiSourceId, string> = { "ai-import": "AI document import", "ai-assistant": "Pricewire assistant" };
const QUEUE_DAYS = 30;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // the API takes 32 MB per request; base64 adds a third
const MAX_TEXT_CHARS = 600_000;

/** The API client, or null when no key is configured (the admin then says how to add one). */
export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;
export const aiClient = () => (aiReady() ? new Anthropic() : null);

export async function ensureAiSources(db: any) {
  for (const id of AI_SOURCES) {
    await db.priceSource.upsert({
      where: { id }, update: {},
      create: { id, label: SOURCE_LABELS[id], kind: "advisory", priceIncludesVat: true, allowAutoApply: false, enabled: true },
    });
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const normCode = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---- reading a document ---------------------------------------------------------

export type PriceType = "retail" | "trade" | "unknown";
export type DocRow = { model: string; ean: string; brand: string; description: string; price: number | null; wasPrice: number | null; priceType: PriceType };
export type DocRead = {
  via: "table" | "ai"; kind: string; supplier: string; pricesIncludeVat: boolean; notes: string; rows: DocRow[];
  usage?: { inputTokens: number; outputTokens: number };
};

const ROW_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["model", "ean", "brand", "description", "price", "wasPrice", "priceType"],
  properties: {
    model: { type: "string", description: "Model number exactly as printed, e.g. WGG24409GB" },
    ean: { type: "string", description: "EAN/barcode digits, or empty" },
    brand: { type: "string", description: "Brand, or empty" },
    description: { type: "string", description: "Short product description as printed" },
    price: { type: "number", description: "The price for this line in GBP; 0 when the line has none" },
    wasPrice: { type: "number", description: "A crossed-out, was or RRP price shown beside it; 0 when none" },
    priceType: { type: "string", enum: ["retail", "trade", "unknown"], description: "retail = what a customer pays; trade = cost/net/dealer/B2B" },
  },
};
const DOC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["kind", "supplier", "pricesIncludeVat", "notes", "rows"],
  properties: {
    kind: { type: "string", description: "What the document is, e.g. 'Bosch promotion flyer', 'supplier price list', 'competitor screenshot'" },
    supplier: { type: "string", description: "Who issued it, or empty" },
    pricesIncludeVat: { type: "boolean", description: "true unless the document says prices exclude VAT (ex VAT, net, + VAT)" },
    notes: { type: "string", description: "Anything the owner should know: validity dates, conditions, unreadable parts" },
    rows: { type: "array", items: ROW_SCHEMA },
  },
};

const EXTRACT_SYSTEM = `You read price documents for Euronics Jyotsna Electrical, an appliance shop in Ruislip, UK: supplier price lists, promotion flyers, quotes, emails and screenshots of other shops' prices.

Return every product line that has a model number. Rules:
- model: copy the model number exactly as printed. Skip lines with no model number.
- price: the price on that line in pounds. If a line shows a promotion or offer price and a normal price, the promotion price is price and the normal price is wasPrice.
- priceType: "retail" when it is what a customer pays (selling price, RRP, offer price, a shop's advertised price); "trade" when it is a cost, net, dealer, B2B or invoice price. If you can't tell, "unknown".
- pricesIncludeVat: false only when the document says its prices exclude VAT.
- Never guess a number that isn't in the document. Use 0 for a missing price.
- Put validity dates, conditions (e.g. "while stocks last", "trade-in required") and anything you couldn't read in notes.`;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

/** Text of a .docx (a zip of XML): the runs of each paragraph, one paragraph per line. */
function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" && f.originalSize < 50_000_000 });
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  if (!xml) throw new Error("Couldn't read that Word file.");
  return xml.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""))
    .map((s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim()).filter(Boolean).join("\n");
}

/** A money value the model or a cell gave, cleaned: positive, plausible, two decimals — else null. */
export const cleanPrice = (n: unknown): number | null => {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(v) && v > 0 && v < 100_000 ? round2(v) : null;
};

export function cleanRows(raw: any[]): DocRow[] {
  const out: DocRow[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const model = String(r?.model ?? "").trim().slice(0, 40);
    if (normCode(model).length < 3) continue;
    const price = cleanPrice(r?.price);
    const was = cleanPrice(r?.wasPrice);
    const key = `${normCode(model)}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ean = String(r?.ean ?? "").replace(/\D/g, "");
    out.push({
      model, ean: /^\d{8,14}$/.test(ean) ? ean : "", brand: String(r?.brand ?? "").trim().slice(0, 40),
      description: String(r?.description ?? "").trim().slice(0, 160), price,
      wasPrice: was !== null && price !== null && was > price ? was : null,
      priceType: r?.priceType === "retail" || r?.priceType === "trade" ? r.priceType : "unknown",
    });
  }
  return out;
}

/**
 * The rows of an uploaded document. The CIH spreadsheet is read directly; any
 * other file is read by Claude Haiku against DOC_SCHEMA (structured output, so
 * the reply is valid JSON by construction).
 */
export async function readDocument(name: string, bytes: Uint8Array): Promise<DocRead> {
  const e = ext(name);
  if (e === "xlsx" || e === "csv") {
    try {
      const rows = parsePriceList(name, bytes).filter((r) => r.price !== null);
      if (rows.length) {
        return {
          via: "table", kind: "Euronics (CIH) price list", supplier: "Euronics", pricesIncludeVat: true, notes: "",
          rows: rows.map((r) => ({ model: r.model, ean: r.ean, brand: "", description: "", price: r.price, wasPrice: null, priceType: "retail" as const })),
        };
      }
    } catch { /* not the CIH layout: the AI reads it below */ }
  }

  let content: Anthropic.ContentBlockParam[];
  if (e === "pdf") {
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } }];
  } else if (IMAGE_TYPES[e]) {
    content = [{ type: "image", source: { type: "base64", media_type: IMAGE_TYPES[e], data: Buffer.from(bytes).toString("base64") } }];
  } else {
    const text = e === "xlsx" || e === "csv" ? readTable(name, bytes).map((r) => r.map((c) => String(c ?? "")).join("\t")).join("\n")
      : e === "docx" ? docxText(bytes)
        : e === "txt" || e === "tsv" || e === "eml" ? strFromU8(bytes)
          : (() => { throw new Error("Upload a PDF, a photo or screenshot (PNG/JPG), an Excel or CSV file, a Word file or a text file."); })();
    if (!text.trim()) throw new Error("That file has no text in it.");
    if (text.length > MAX_TEXT_CHARS) throw new Error("That file is too long to read in one go — split it into smaller files.");
    content = [{ type: "text", text: `File: ${name}\n\n${text}` }];
  }

  const client = aiClient();
  if (!client) throw new Error("The AI isn't set up: add ANTHROPIC_API_KEY to the site's settings.");
  const msg = await client.messages.stream({
    model: AI_MODEL,
    max_tokens: 64000,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: DOC_SCHEMA } },
    messages: [{ role: "user", content: [...content, { type: "text", text: "Extract every product line with its price." }] }],
  }).finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("The AI declined to read that file.");
  if (msg.stop_reason === "max_tokens") throw new Error("That document has too many lines to read in one go — split it into smaller files.");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error("The AI's answer couldn't be read — try again."); }
  return {
    via: "ai", kind: String(parsed.kind || "document").slice(0, 120), supplier: String(parsed.supplier || "").slice(0, 120),
    pricesIncludeVat: parsed.pricesIncludeVat !== false, notes: String(parsed.notes || "").slice(0, 1000), rows: cleanRows(parsed.rows),
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
  };
}

// ---- matching rows to our products ---------------------------------------------------

type ProductKey = { id: string; productCode: string; gtin?: string | null; brand?: string | null };
export type Match = { productIds: string[]; by: "code" | "ean" | "close" | "" };

/**
 * Which of our products a row is about: the same model code (ignoring spaces,
 * dashes and case), else the EAN, else ONE product whose code differs only by a
 * short suffix (WGG24409GB vs WGG24409GB/01) — and of the same brand when the
 * row names one. Anything less certain stays unmatched for the owner to see.
 */
export function makeMatcher(products: ProductKey[]) {
  const byCode = new Map<string, string[]>(), byEan = new Map<string, string[]>();
  for (const p of products) {
    const c = normCode(p.productCode);
    if (c) byCode.set(c, [...(byCode.get(c) || []), p.id]);
    if (p.gtin) byEan.set(p.gtin, [...(byEan.get(p.gtin) || []), p.id]);
  }
  const codes = products.map((p) => ({ id: p.id, code: normCode(p.productCode), brand: String(p.brand || "").toLowerCase() })).filter((p) => p.code.length >= 5);
  return (row: { model: string; ean: string; brand: string }): Match => {
    const n = normCode(row.model);
    if (byCode.has(n)) return { productIds: byCode.get(n)!, by: "code" };
    if (row.ean && byEan.has(row.ean)) return { productIds: byEan.get(row.ean)!, by: "ean" };
    if (n.length < 5) return { productIds: [], by: "" };
    let near = codes.filter((p) => (p.code.startsWith(n) || n.startsWith(p.code)) && Math.abs(p.code.length - n.length) <= 3);
    const brand = row.brand.toLowerCase();
    if (near.length > 1 && brand) near = near.filter((p) => p.brand === brand);
    return near.length === 1 ? { productIds: [near[0].id], by: "close" } : { productIds: [], by: "" };
  };
}

// ---- staging a document's prices ------------------------------------------------------

export type ImportSummary = {
  file: string; via: DocRead["via"]; kind: string; supplier: string; notes: string; pricesIncludeVat: boolean;
  rows: number; priced: number; matched: number; staged: number; unchanged: number; trade: number; callForPrice: number; hidden: number;
  closeMatches: number; unmatched: { model: string; description: string; price: number | null }[];
  usage?: DocRead["usage"];
};

/** Every retail price in the document becomes an "ai-import" observation for review. */
export async function stageDocument(db: any, file: string, read: DocRead, by: string): Promise<ImportSummary> {
  await ensureAiSources(db);
  const [products, poa] = await Promise.all([
    db.product.findMany({ select: { id: true, productCode: true, gtin: true, brand: true, priceNow: true, isVisible: true, category: true, subcategory: true } }),
    poaNamesFromDb(db),
  ]);
  const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));
  const match = makeMatcher(products);
  const s: ImportSummary = {
    file, via: read.via, kind: read.kind, supplier: read.supplier, notes: read.notes, pricesIncludeVat: read.pricesIncludeVat,
    rows: read.rows.length, priced: 0, matched: 0, staged: 0, unchanged: 0, trade: 0, callForPrice: 0, hidden: 0, closeMatches: 0, unmatched: [], usage: read.usage,
  };
  const now = new Date();
  const obs: any[] = [];
  for (const r of read.rows) {
    if (r.price !== null) s.priced++;
    const m = match(r);
    if (!m.productIds.length) { if (s.unmatched.length < 200) s.unmatched.push({ model: r.model, description: r.description, price: r.price }); continue; }
    s.matched++;
    if (m.by === "close") s.closeMatches++;
    if (r.price === null) continue;
    if (r.priceType === "trade") { s.trade++; continue; }
    for (const id of m.productIds) {
      const p = byId.get(id);
      if (!p.isVisible) { s.hidden++; continue; }
      if (isPoaProduct(poa, p)) { s.callForPrice++; continue; }
      const inc = read.pricesIncludeVat ? r.price : round2(r.price * 1.2);
      if (typeof p.priceNow === "number" && Math.abs(p.priceNow - inc) < 0.01) { s.unchanged++; continue; }
      obs.push({
        productId: id, sourceId: "ai-import", price: r.price, deliveryCost: null, inStock: null, includesVat: read.pricesIncludeVat,
        sourceUrl: `upload:${file}`.slice(0, 190), matchConfidence: m.by === "close" ? 0.85 : 1, status: "ok", observedAt: now,
        note: [file, r.description, r.priceType === "unknown" ? "price type unclear" : "", r.wasPrice ? `was £${r.wasPrice}` : ""].filter(Boolean).join(" · ").slice(0, 190),
      });
    }
  }
  for (let i = 0; i < obs.length; i += 500) await db.priceObservation.createMany({ data: obs.slice(i, i + 500) });
  s.staged = obs.length;
  await writeAudit(db, {
    entityType: "pricewire-ai", entityId: file.slice(0, 120), action: "pricewire:ai-import", changedFields: [],
    previousValue: {}, newValue: { via: read.via, kind: read.kind, rows: s.rows, matched: s.matched, staged: s.staged, trade: s.trade, usage: read.usage ?? null },
    changedBy: by,
  });
  await db.priceSource.update({ where: { id: "ai-import" }, data: { lastRunAt: now, lastRunStatus: `${file}: ${s.staged} to review`.slice(0, 200) } }).catch(() => {});
  return s;
}

// ---- the review queue ------------------------------------------------------------------

export type QueueFlag = "call_for_price" | "hidden" | "euronics_agency" | "owner_set" | "big_move" | "first_price" | "close_match" | "below_cost";
export type QueueItem = {
  productId: string; sourceId: AiSourceId; code: string; title: string; brand: string; slug: string;
  from: number | null; to: number; changePct: number | null; note: string; observedAt: string; flags: QueueFlag[];
};

/**
 * The newest AI price per product and source from the last 30 days that would
 * still change something: not dismissed, different from today's price, and
 * newer than the owner's last edit of that product.
 */
export async function aiQueue(db: any): Promise<QueueItem[]> {
  const since = new Date(Date.now() - QUEUE_DAYS * 86_400_000);
  const rows: any[] = await db.priceObservation.findMany({
    where: { sourceId: { in: [...AI_SOURCES] }, status: "ok", observedAt: { gte: since } },
    orderBy: { observedAt: "desc" }, take: 5000,
    select: { productId: true, sourceId: true, price: true, includesVat: true, note: true, observedAt: true, matchConfidence: true },
  });
  const latest = new Map<string, any>();
  for (const o of rows) { const k = `${o.productId}|${o.sourceId}`; if (!latest.has(k)) latest.set(k, o); }
  if (!latest.size) return [];
  const ids = [...new Set([...latest.values()].map((o) => o.productId))];
  const [products, poa] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, productCode: true, title: true, brand: true, slug: true, priceNow: true, isVisible: true, category: true, subcategory: true, agencyStock: true, adminOverrideFields: true, lastUpdatedByAdmin: true, costPrice: true } }),
    poaNamesFromDb(db),
  ]);
  const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));
  const out: QueueItem[] = [];
  for (const o of latest.values()) {
    const p = byId.get(o.productId);
    if (!p || typeof o.price !== "number") continue;
    const to = o.includesVat === false ? round2(o.price * 1.2) : round2(o.price);
    if (typeof p.priceNow === "number" && Math.abs(p.priceNow - to) < 0.01) continue;
    if (p.lastUpdatedByAdmin && new Date(p.lastUpdatedByAdmin) > new Date(o.observedAt)) continue;
    const flags: QueueFlag[] = [];
    if (isPoaProduct(poa, p)) flags.push("call_for_price");
    if (!p.isVisible) flags.push("hidden");
    if (p.agencyStock === true) flags.push("euronics_agency");
    if (Array.isArray(p.adminOverrideFields) && p.adminOverrideFields.includes("priceNow")) flags.push("owner_set");
    if (typeof p.priceNow !== "number") flags.push("first_price");
    else if (Math.abs(to - p.priceNow) / p.priceNow > 0.3) flags.push("big_move");
    if (typeof o.matchConfidence === "number" && o.matchConfidence < 1) flags.push("close_match");
    if (typeof p.costPrice === "number" && to < p.costPrice * 1.2) flags.push("below_cost");
    out.push({
      productId: p.id, sourceId: o.sourceId, code: p.productCode, title: p.title, brand: p.brand, slug: p.slug,
      from: typeof p.priceNow === "number" ? p.priceNow : null, to,
      changePct: typeof p.priceNow === "number" && p.priceNow > 0 ? Math.round(((to - p.priceNow) / p.priceNow) * 1000) / 10 : null,
      note: o.note || "", observedAt: new Date(o.observedAt).toISOString(), flags,
    });
  }
  return out.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.code.localeCompare(b.code));
}

/** Drop suggestions from the queue: their observations are marked dismissed, so Apply refuses them too. */
export async function dismissQueued(db: any, items: { productId: string; sourceId: string }[], by: string): Promise<number> {
  const since = new Date(Date.now() - QUEUE_DAYS * 86_400_000);
  let n = 0;
  for (const it of items) {
    if (!(AI_SOURCES as readonly string[]).includes(it.sourceId)) continue;
    const r = await db.priceObservation.updateMany({ where: { productId: it.productId, sourceId: it.sourceId, status: "ok", observedAt: { gte: since } }, data: { status: "dismissed" } });
    n += r.count;
  }
  if (n) await writeAudit(db, { entityType: "pricewire-ai", entityId: "queue", action: "pricewire:ai-dismiss", changedFields: [], previousValue: {}, newValue: { items: items.length }, changedBy: by });
  return n;
}
