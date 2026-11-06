import Anthropic from "@anthropic-ai/sdk";
import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { writeAudit } from "@/lib/audit";
import { AI_MODEL, aiClient, cleanPrice, ensureAiSources, normCode } from "@/lib/price-watch/pricewire-ai";

/**
 * The Pricewire assistant: a chat in Admin → Pricewire that looks things up
 * with tools — products, every price we hold for them, views and calls — and
 * suggests offers. It can PROPOSE a price (an "ai-assistant" observation that
 * lands in the review queue) but has no tool that changes one: the owner
 * applies from the queue, through the guarded apply route.
 *
 * The conversation is kept by the browser and sent back whole each turn,
 * append-only (assistant turns exactly as the API returned them, thinking
 * blocks included), so the server holds no chat state.
 */

const MAX_ROUNDS = 8;
const MAX_HISTORY_CHARS = 400_000;
const DAY = 86_400_000;

const SYSTEM = `You are the pricing assistant inside the back office of Euronics Jyotsna Electrical (kitchen-appliances.co.uk), a family-run appliance shop in South Ruislip, London, and a Euronics agent. You talk to the owner, Sachin.

What you can do: look up products and every price the shop holds for them (our price, Euronics' price, the price on the site Pricewire follows for Bosch, Neff and Siemens, prices read from uploaded documents), see how often each product was viewed and phoned about in the last 30 days, find offer opportunities, and propose new prices.

Rules:
- Use the tools for every fact. Never state a price, count or trend you didn't get from a tool.
- Prices are in pounds including VAT.
- You cannot change prices. propose_price puts a suggestion in the review queue on this page; Sachin applies or dismisses it there. Say that plainly after proposing, and never say a price "has been changed".
- Products marked euronics_agency are Euronics agency stock: Euronics sets that price, so don't propose a different one unless Sachin asks.
- Products marked call_for_price must not get a price; don't propose one.
- When a cost or floor is known, never propose below it.
- For offers, look for: products dearer than the other sources (lose sales), products viewed often but never called about (price or page needs a look), and products with a known source price that show no price.
- Be concise: short paragraphs or a compact list, each suggestion with the model code, the price now, the suggested price and the reason in numbers.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products", strict: true,
    description: "Find products by model code, brand or words in the title. Returns up to `limit` products with their price now.",
    input_schema: { type: "object", additionalProperties: false, required: ["query", "limit"], properties: {
      query: { type: "string", description: "Model code or words, e.g. 'WGG24409GB' or 'bosch washing machine 9kg'" },
      limit: { type: "integer", description: "1 to 25" },
    } },
  },
  {
    name: "product_report", strict: true,
    description: "Everything about one product: our price, was price, cost if known, stock flags, the latest price from every source, and views and call taps in the last 30 days.",
    input_schema: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", description: "Model code" } } },
  },
  {
    name: "offer_opportunities", strict: true,
    description: "Lists products worth a pricing decision. kind: dearer_than_sources (our price is above another source by 2%+), cheaper_than_sources (we are 5%+ below every source), viewed_not_called (4+ views in 30 days, no call), no_price_but_source_price (no price shown but a source has one).",
    input_schema: { type: "object", additionalProperties: false, required: ["kind", "brand", "limit"], properties: {
      kind: { type: "string", enum: ["dearer_than_sources", "cheaper_than_sources", "viewed_not_called", "no_price_but_source_price"] },
      brand: { type: "string", description: "Limit to one brand, or empty for all" },
      limit: { type: "integer", description: "1 to 30" },
    } },
  },
  {
    name: "propose_price", strict: true,
    description: "Put a suggested price for one product in the owner's review queue. Does not change the price.",
    input_schema: { type: "object", additionalProperties: false, required: ["code", "price", "reason"], properties: {
      code: { type: "string" }, price: { type: "number", description: "Suggested price in pounds including VAT" },
      reason: { type: "string", description: "One sentence with the numbers behind it" },
    } },
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Ctx = { db: any; by: string; poa: Set<string>; proposals: Proposal[] };
/** One source's latest price for a product, inc VAT. sourceId is the price source, or "pricewire:<site>" for the site Pricewire follows. */
export type SourcePrice = { sourceId: string; source: string; price: number; at: string };
export type Proposal = { code: string; title: string; from: number | null; to: number; reason: string };

async function findProduct(db: any, code: string) {
  const n = normCode(code);
  if (!n) return null;
  const all: any[] = await db.product.findMany({ select: { id: true, productCode: true } });
  const hit = all.find((p) => normCode(p.productCode) === n);
  return hit ? db.product.findUnique({ where: { id: hit.id } }) : null;
}

/**
 * Latest price per source for these products: observations from the last 14
 * days and Pricewire's followed site. Prices read from uploaded documents count
 * (a competitor's screenshot is evidence, labelled with its file); the
 * assistant's own proposals don't, or it would compare against itself.
 */
export async function sourcePrices(db: any, ids: string[]): Promise<Map<string, SourcePrice[]>> {
  const since = new Date(Date.now() - 14 * DAY);
  const [obs, items, sources] = await Promise.all([
    db.priceObservation.findMany({ where: { productId: { in: ids }, observedAt: { gte: since }, status: "ok", NOT: { sourceId: { in: ["ai-assistant", "pricing-rules"] } } }, orderBy: { observedAt: "desc" }, select: { productId: true, sourceId: true, price: true, includesVat: true, observedAt: true, note: true } }),
    db.brandPriceItem.findMany({ where: { productId: { in: ids } }, select: { productId: true, siteId: true, price: true, readAt: true } }).catch(() => []),
    db.priceSource.findMany({ select: { id: true, label: true } }),
  ]);
  const label = new Map<string, string>(sources.map((s: any) => [s.id, s.label]));
  const out = new Map<string, SourcePrice[]>();
  const seen = new Set<string>();
  for (const o of obs) {
    // Each uploaded document is its own source: a later screenshot must not hide a flyer's lower price.
    const doc = o.sourceId === "ai-import" ? String(o.note || "").split(" · ")[0] : "";
    const k = `${o.productId}|${o.sourceId}|${doc}`;
    if (seen.has(k) || typeof o.price !== "number") continue;
    seen.add(k);
    const price = o.includesVat === false ? round2(o.price * 1.2) : o.price;
    const source = doc ? `Document: ${doc}` : label.get(o.sourceId) || o.sourceId;
    out.set(o.productId, [...(out.get(o.productId) || []), { sourceId: o.sourceId, source, price, at: new Date(o.observedAt).toISOString().slice(0, 10) }]);
  }
  for (const it of items) {
    if (typeof it.price !== "number") continue;
    out.set(it.productId, [...(out.get(it.productId) || []), { sourceId: `pricewire:${it.siteId}`, source: `Pricewire (${it.siteId})`, price: it.price, at: it.readAt ? new Date(it.readAt).toISOString().slice(0, 10) : "" }]);
  }
  return out;
}

async function engagement(db: any, slugs: string[]) {
  const since = new Date(Date.now() - 30 * DAY);
  const ev: any[] = await db.trackedEvent.findMany({ where: { productSlug: { in: slugs }, createdAt: { gte: since }, type: { in: ["page_view", "call_click"] } }, select: { productSlug: true, type: true } });
  const m = new Map<string, { views: number; calls: number }>();
  for (const e of ev) { const x = m.get(e.productSlug) || { views: 0, calls: 0 }; if (e.type === "page_view") x.views++; else x.calls++; m.set(e.productSlug, x); }
  return m;
}

const flagsOf = (p: any, poa: Set<string>) => [
  ...(isPoaProduct(poa, p) ? ["call_for_price"] : []), ...(p.agencyStock === true ? ["euronics_agency"] : []),
  ...(!p.isVisible ? ["hidden"] : []), ...(Array.isArray(p.adminOverrideFields) && p.adminOverrideFields.includes("priceNow") ? ["owner_set_price"] : []),
];

export async function runTool(name: string, input: any, ctx: Ctx): Promise<unknown> {
  const { db, poa } = ctx;
  if (name === "search_products") {
    const q = String(input.query || "").trim();
    const limit = Math.min(25, Math.max(1, Number(input.limit) || 10));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all: any[] = await db.product.findMany({ select: { id: true, productCode: true, title: true, brand: true, category: true, pricewire: true, subcategory: true, priceNow: true, isVisible: true, agencyStock: true, adminOverrideFields: true } });
    const hits = all.filter((r) => {
      const text = `${r.productCode} ${r.title} ${r.brand} ${r.category} ${r.subcategory}`.toLowerCase();
      const flat = squash(text);
      return words.every((w) => text.includes(w) || (squash(w) && flat.includes(squash(w))));
    });
    const code = squash(q);
    hits.sort((a, b) => Number(squash(b.productCode) === code) - Number(squash(a.productCode) === code));
    return { total: hits.length, products: hits.slice(0, limit).map((p) => ({ code: p.productCode, title: p.title, brand: p.brand, category: p.subcategory || p.category, price: p.priceNow, flags: flagsOf(p, poa) })) };
  }
  if (name === "product_report") {
    const p = await findProduct(db, input.code);
    if (!p) return { error: `No product with model code ${input.code}.` };
    const [prices, eng] = await Promise.all([sourcePrices(db, [p.id]), engagement(db, [p.slug])]);
    return {
      code: p.productCode, title: p.title, brand: p.brand, category: p.subcategory || p.category, price: p.priceNow, wasPrice: p.priceWas,
      costExVat: p.costPrice, floor: p.floorPrice, flags: flagsOf(p, poa), otherPrices: prices.get(p.id) || [],
      last30Days: eng.get(p.slug) || { views: 0, calls: 0 }, url: `/products/${p.slug}`,
    };
  }
  if (name === "offer_opportunities") {
    const limit = Math.min(30, Math.max(1, Number(input.limit) || 15));
    const brand = String(input.brand || "").trim().toLowerCase();
    const products: any[] = (await db.product.findMany({ where: { isVisible: true }, select: { id: true, slug: true, productCode: true, title: true, brand: true, category: true, pricewire: true, subcategory: true, priceNow: true, agencyStock: true, costPrice: true, isVisible: true, adminOverrideFields: true } }))
      .filter((p: any) => (!brand || String(p.brand).toLowerCase() === brand) && !isPoaProduct(poa, p));
    const kind = String(input.kind);
    if (kind === "viewed_not_called") {
      const eng = await engagement(db, products.map((p) => p.slug));
      const list = products.map((p) => ({ p, e: eng.get(p.slug) || { views: 0, calls: 0 } })).filter((x) => x.e.views >= 4 && x.e.calls === 0).sort((a, b) => b.e.views - a.e.views).slice(0, limit);
      const prices = await sourcePrices(db, list.map((x) => x.p.id));
      return { kind, products: list.map(({ p, e }) => ({ code: p.productCode, title: p.title, price: p.priceNow, views30d: e.views, otherPrices: prices.get(p.id) || [], flags: flagsOf(p, poa) })) };
    }
    const prices = await sourcePrices(db, products.map((p) => p.id));
    const rows = products.map((p) => {
      const others = prices.get(p.id) || [];
      const low = others.length ? Math.min(...others.map((o) => o.price)) : null;
      return { p, others, low };
    }).filter(({ p, low }) => {
      if (low === null) return false;
      if (kind === "no_price_but_source_price") return typeof p.priceNow !== "number";
      if (typeof p.priceNow !== "number") return false;
      if (kind === "dearer_than_sources") return p.priceNow > low * 1.02;
      if (kind === "cheaper_than_sources") return p.priceNow < low * 0.95;
      return false;
    }).sort((a, b) => Math.abs((b.p.priceNow ?? 0) - (b.low ?? 0)) - Math.abs((a.p.priceNow ?? 0) - (a.low ?? 0))).slice(0, limit);
    return { kind, products: rows.map(({ p, others, low }) => ({ code: p.productCode, title: p.title, price: p.priceNow, lowestOther: low, otherPrices: others, costExVat: p.costPrice, flags: flagsOf(p, poa) })) };
  }
  if (name === "propose_price") {
    const p = await findProduct(db, input.code);
    if (!p) return { error: `No product with model code ${input.code}.` };
    const price = cleanPrice(input.price);
    if (price === null) return { error: "That isn't a usable price." };
    if (isPoaProduct(poa, p)) return { error: `${p.productCode} is call-for-price, so it can't be given a price.` };
    if (!p.isVisible) return { error: `${p.productCode} is hidden from the shop.` };
    if (typeof p.costPrice === "number" && price < p.costPrice * 1.2) return { error: `£${price} is below cost (£${round2(p.costPrice * 1.2)} inc VAT).` };
    if (typeof p.floorPrice === "number" && price < p.floorPrice) return { error: `£${price} is below the floor price £${p.floorPrice}.` };
    await ensureAiSources(db);
    const reason = String(input.reason || "").trim().slice(0, 160);
    await db.priceObservation.create({ data: {
      productId: p.id, sourceId: "ai-assistant", price, deliveryCost: null, inStock: null, includesVat: true, sourceUrl: "assistant",
      matchConfidence: 1, status: "ok", note: `Assistant: ${reason}`.slice(0, 190), observedAt: new Date(),
    } });
    await writeAudit(db, { entityType: "product", entityId: p.id, action: "pricewire:ai-propose", changedFields: [], previousValue: { priceNow: p.priceNow }, newValue: { proposed: price, reason }, changedBy: ctx.by });
    ctx.proposals.push({ code: p.productCode, title: p.title, from: p.priceNow, to: price, reason });
    return { ok: true, code: p.productCode, from: p.priceNow, proposed: price, note: "In the review queue — the owner applies or dismisses it.", flags: flagsOf(p, poa) };
  }
  return { error: `Unknown tool ${name}.` };
}

/** A conversation the browser sent back, checked enough to forward: roles alternate from a user turn, and it isn't huge. */
export function validHistory(messages: unknown): messages is Anthropic.MessageParam[] {
  if (!Array.isArray(messages) || JSON.stringify(messages).length > MAX_HISTORY_CHARS) return false;
  return messages.every((m: any) => (m?.role === "user" || m?.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)))
    && (messages.length === 0 || (messages[0] as any).role === "user");
}

export type AgentTurn = { messages: Anthropic.MessageParam[]; reply: string; proposals: Proposal[]; tools: { name: string; input: unknown }[]; stopped?: string };

export async function runAgent(db: any, history: Anthropic.MessageParam[], userText: string, by: string): Promise<AgentTurn> {
  const client = aiClient();
  if (!client) throw new Error("The AI isn't set up: add ANTHROPIC_API_KEY to the site's settings.");
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userText }];
  const ctx: Ctx = { db, by, poa: await poaNamesFromDb(db), proposals: [] };
  const used: { name: string; input: unknown }[] = [];
  let reply = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: AI_MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages,
      cache_control: { type: "ephemeral" }, output_config: { effort: "medium" },
    });
    messages.push({ role: "assistant", content: res.content });
    reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (res.stop_reason === "refusal") return { messages, reply: reply || "I can't help with that one.", proposals: ctx.proposals, tools: used, stopped: "refusal" };
    if (res.stop_reason !== "tool_use") return { messages, reply, proposals: ctx.proposals, tools: used, stopped: res.stop_reason === "max_tokens" ? "max_tokens" : undefined };
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      used.push({ name: b.name, input: b.input });
      try {
        const out = await runTool(b.name, b.input, ctx);
        const text = JSON.stringify(out);
        results.push({ type: "tool_result", tool_use_id: b.id, content: text.length > 24_000 ? text.slice(0, 24_000) + "…(truncated)" : text, is_error: !!(out as any)?.error });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: `Tool failed: ${(e as Error).message}`.slice(0, 300), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { messages, reply: reply || "I ran out of steps on that one — ask me a narrower question.", proposals: ctx.proposals, tools: used, stopped: "rounds" };
}
