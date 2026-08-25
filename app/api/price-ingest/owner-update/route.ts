import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { verifyMachineRequest, readRawBody, loadMachineKey } from "@/lib/machine-auth";
import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { revalidateStorefront } from "@/lib/revalidate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/price-ingest/owner-update
 *
 * The owner relaying prices from WhatsApp: "WAN28259GB 429", or a whole
 * checklist. Two calls, always:
 *
 *   1. PROPOSE  { items:[{productCode, price}] }
 *      -> what would change, what is blocked and why, plus a confirmToken.
 *         Nothing is written.
 *   2. CONFIRM  { items:[...], confirmToken }
 *      -> applies exactly the proposal that token was minted for.
 *
 * WHY THIS ROUTE MAY DO WHAT THE COLLECTOR MAY NOT
 * Every other ingest path is forbidden from touching Product.priceNow, because
 * a scrape is a machine's opinion. This is the OWNER's instruction, which is the
 * same authority the admin panel already carries — so it sets the price directly
 * rather than filing an observation. The guards in lib/price-watch exist to stop
 * machines, not the shopkeeper.
 *
 * What still applies, because it protects the owner from himself:
 *   - call-for-price categories are refused outright (they must never carry a price)
 *   - the confirmToken is bound to the EXACT items, so an edited list needs a
 *     fresh proposal; a stale or tampered confirm is rejected
 *   - large swings are flagged in the proposal so the human sees them before confirming
 *   - every applied change is written to the audit log as whatsapp:<keyId>
 *   - priceNow is locked into adminOverrideFields, so a later import cannot
 *     silently undo what the owner just set
 */

const MAX_ITEMS = 200;
const CONFIRM_WINDOW_SECONDS = 900; // 15 min to read the message and reply
const BIG_MOVE = 0.5; // flag a >50% swing for the human, never silently apply

type Item = { productCode: string; price: number };

/** Canonical form of the request — the confirmToken is bound to exactly this. */
const canonical = (items: Item[]) =>
  items.map((i) => `${i.productCode.toUpperCase()}:${i.price.toFixed(2)}`).sort().join("|");

function mintToken(secret: string, items: Item[], issuedAt: number): string {
  const mac = createHmac("sha256", secret).update(`owner-update.confirm.${canonical(items)}.${issuedAt}`).digest("hex");
  return `${issuedAt}.${mac}`;
}

function tokenValid(secret: string, items: Item[], token: string): boolean {
  const [issuedRaw, mac] = String(token || "").split(".");
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt) || !mac) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > CONFIRM_WINDOW_SECONDS) return false;
  const expect = createHmac("sha256", secret).update(`owner-update.confirm.${canonical(items)}.${issuedAt}`).digest("hex");
  if (expect.length !== mac.length) return false;
  try { return timingSafeEqual(Buffer.from(expect, "hex"), Buffer.from(mac, "hex")); } catch { return false; }
}

/** "429", "£429", "429.99" -> 429.99 ; anything else -> null (never 0). */
function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export async function POST(req: Request) {
  const rawBody = await readRawBody(req);
  const auth = verifyMachineRequest(req, rawBody, "owner-update");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const key = loadMachineKey(auth.keyId);
  if (!key) return NextResponse.json({ error: "Unknown key" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }

  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  if (raw.length > MAX_ITEMS) return NextResponse.json({ error: `Too many items (${raw.length}); max ${MAX_ITEMS}` }, { status: 400 });

  // Normalise first, so the token is bound to what we actually understood.
  const items: Item[] = [];
  const rejected: { productCode: string; reason: string }[] = [];
  for (const r of raw) {
    const code = String(r?.productCode ?? r?.code ?? "").trim();
    const price = parsePrice(r?.price);
    if (!code) { rejected.push({ productCode: "(blank)", reason: "missing product code" }); continue; }
    if (price === null) { rejected.push({ productCode: code, reason: "price is not a positive number" }); continue; }
    items.push({ productCode: code, price });
  }
  if (!items.length) return NextResponse.json({ error: "No usable items", rejected }, { status: 400 });

  try {
    const db = await getPrisma();
    const poa = await poaNamesFromDb(db);
    const found = await db.product.findMany({
      where: { productCode: { in: items.map((i) => i.productCode) } },
      select: { id: true, productCode: true, title: true, brand: true, slug: true, priceNow: true, priceWas: true, category: true, subcategory: true, adminOverrideFields: true },
    });
    const byCode = new Map<string, (typeof found)[number][]>();
    for (const p of found) {
      const k = p.productCode.toUpperCase();
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k)!.push(p);
    }

    type Row = { productCode: string; title?: string; brand?: string; currentPrice?: number | null; newPrice: number; diff?: number | null; blocked?: string; warning?: string };
    const changes: Row[] = [];
    const applicable: { product: (typeof found)[number]; price: number }[] = [];

    for (const it of items) {
      const matches = byCode.get(it.productCode.toUpperCase()) || [];
      if (!matches.length) { changes.push({ productCode: it.productCode, newPrice: it.price, blocked: "no product with that code" }); continue; }
      // 198 BSH part numbers exist under both Bosch and Neff — an ambiguous code
      // must not be resolved by guessing which one he meant.
      if (matches.length > 1) { changes.push({ productCode: it.productCode, newPrice: it.price, blocked: `code matches ${matches.length} products (${matches.map((m) => m.brand).join(", ")}) — reply with the brand` }); continue; }
      const p = matches[0];
      if (isPoaProduct(poa, p)) { changes.push({ productCode: it.productCode, title: p.title, brand: p.brand, newPrice: it.price, blocked: "call-for-price category — these never show a price" }); continue; }

      const cur = p.priceNow;
      const diff = cur === null ? null : Math.round((it.price - cur) * 100) / 100;
      const warning = cur !== null && cur > 0 && Math.abs(it.price - cur) / cur > BIG_MOVE
        ? `large change: ${Math.round((Math.abs(it.price - cur) / cur) * 100)}%` : undefined;
      changes.push({ productCode: p.productCode, title: p.title, brand: p.brand, currentPrice: cur, newPrice: it.price, diff, warning });
      applicable.push({ product: p, price: it.price });
    }

    const confirmToken = String(body?.confirmToken || "");

    // ---- step 1: propose ----
    if (!confirmToken) {
      const issuedAt = Math.floor(Date.now() / 1000);
      return NextResponse.json({
        stage: "proposed",
        confirmToken: mintToken(key.secret, items, issuedAt),
        expiresInSeconds: CONFIRM_WINDOW_SECONDS,
        summary: { willApply: applicable.length, blocked: changes.filter((c) => c.blocked).length, rejected: rejected.length },
        changes, rejected,
      });
    }

    // ---- step 2: confirm ----
    if (!tokenValid(key.secret, items, confirmToken)) {
      return NextResponse.json({ error: "Confirmation is invalid, expired, or the list changed since it was proposed. Send the list again." }, { status: 409 });
    }

    const applied: Row[] = [];
    for (const { product, price } of applicable) {
      // priceWas keeps the old price visible as a strike-through only when the
      // new price is genuinely lower; otherwise it would advertise a fake saving.
      const priceWas = product.priceNow !== null && product.priceNow > price ? product.priceNow : null;
      const saving = priceWas !== null ? Math.round((priceWas - price) * 100) / 100 : null;
      const locks = new Set<string>(((product.adminOverrideFields as string[]) || []));
      locks.add("priceNow");

      await db.product.update({
        where: { id: product.id },
        data: { priceNow: price, priceWas, saving, adminOverrideFields: [...locks], lastUpdatedByAdmin: new Date() },
      });
      await writeAudit(db, {
        entityType: "product", entityId: product.id, action: "price-update",
        changedFields: ["priceNow"],
        previousValue: { priceNow: product.priceNow }, newValue: { priceNow: price },
        changedBy: `whatsapp:${auth.keyId}`,
      });
      try { await syncProductToRag(db, product.id); } catch { /* chatbot reindex is best effort */ }
      applied.push({ productCode: product.productCode, title: product.title, brand: product.brand, currentPrice: product.priceNow, newPrice: price, diff: product.priceNow === null ? null : Math.round((price - product.priceNow) * 100) / 100 });
    }

    if (applied.length) revalidateStorefront(applicable.map(({ product }) => `/products/${product.slug}`));

    return NextResponse.json({
      stage: "applied",
      summary: { applied: applied.length, blocked: changes.filter((c) => c.blocked).length, rejected: rejected.length },
      applied, blocked: changes.filter((c) => c.blocked), rejected,
    });
  } catch (e) {
    console.error("owner-update", e);
    return NextResponse.json({ error: "Could not update prices. Is the database reachable?" }, { status: 500 });
  }
}
