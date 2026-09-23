/**
 * "Check prices" for one product, from the admin — see lib/price-check.ts.
 *
 *   POST   { productId, addSite? }  check now; addSite adds a site to compare
 *   DELETE { siteId }               stop comparing against an added site
 *
 * Reads only. Every result is stored as a PriceObservation, and that is the
 * whole point: "Use this price" in the panel is the existing, fully guarded
 * /api/admin/price-watch/apply acting on the observation just recorded, so this
 * route never writes a price itself. An admin check also counts toward the
 * nightly auto-apply history (e.g. the second "no offer" read in a row).
 *
 * Added sites are PriceSource rows with id "site:<host>", kind "advisory": they
 * are for comparison, and advisory sources can never auto-apply.
 */
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { isPoaProduct, poaNamesFromDb } from "@/lib/poa";
import { checkPrices, siteHost, type SiteSource } from "@/lib/price-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Only these may set the shop's price, and only from an exact, non-AI read. */
const APPLIABLE = new Set(["euronics", "cih"]);

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "price-check" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!productId) return NextResponse.json({ error: "No product chosen" }, { status: 400 });

  try {
    const db = await getPrisma();
    const p = await db.product.findUnique({
      where: { id: productId },
      select: { id: true, productCode: true, brand: true, title: true, sourceUrl: true, priceNow: true, category: true, subcategory: true },
    });
    if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (!p.productCode) return NextResponse.json({ error: "This product has no model code to search for" }, { status: 400 });

    if (typeof body.addSite === "string" && body.addSite.trim()) {
      const host = siteHost(body.addSite);
      if (!host) return NextResponse.json({ error: "That doesn't look like a website. Try e.g. ao.com" }, { status: 400 });
      const id = `site:${host}`;
      const label = host.replace(/^www\./, "");
      await db.priceSource.upsert({
        where: { id },
        update: { enabled: true },
        create: { id, label, kind: "advisory", allowAutoApply: false, priceIncludesVat: true, enabled: true },
      });
      await writeAudit(db, { entityType: "priceSource", entityId: id, action: "price-check:add-site", changedFields: ["enabled"], previousValue: {}, newValue: { label }, changedBy: gate.admin.email });
    }

    const siteRows = await db.priceSource.findMany({ where: { id: { startsWith: "site:" }, enabled: true }, orderBy: { createdAt: "asc" } });
    const sites: SiteSource[] = siteRows.map((s: any) => ({ id: s.id, label: s.label, host: s.id.slice(5) }));

    // The page each added site was already found on for this product, so only
    // the first check of a product per site spends an AI search.
    const prior = sites.length ? await db.priceObservation.findMany({
      where: { productId: p.id, sourceId: { in: sites.map((s) => s.id) }, matchConfidence: { gt: 0 }, sourceUrl: { not: "" } },
      orderBy: { observedAt: "desc" },
      select: { sourceId: true, sourceUrl: true },
    }) : [];
    const known: Record<string, string> = {};
    for (const o of prior as any[]) if (!known[o.sourceId]) known[o.sourceId] = o.sourceUrl;

    const results = await checkPrices(
      { id: p.id, productCode: p.productCode, brand: p.brand, title: p.title, sourceUrl: p.sourceUrl || "" },
      sites, known,
    );

    // Recorded against sources that exist; a source row missing in this
    // install (no "manufacturer-rrp" yet) is skipped rather than erroring.
    const existing = new Set((await db.priceSource.findMany({ where: { id: { in: results.map((r) => r.sourceId) } }, select: { id: true } })).map((s: any) => s.id));
    const rows = results.filter((r) => existing.has(r.sourceId)).map((r) => ({
      productId: p.id, sourceId: r.sourceId, price: r.price, deliveryCost: null, inStock: r.status === "no_offer" ? false : null,
      includesVat: true, sourceUrl: r.url.slice(0, 1000), matchConfidence: r.matchConfidence, status: r.status,
      note: `admin check${r.aiRead ? " (AI)" : ""}: ${r.note}`.slice(0, 500),
    }));
    if (rows.length) await db.priceObservation.createMany({ data: rows });

    const poa = isPoaProduct(await poaNamesFromDb(db), { category: p.category, subcategory: p.subcategory, brand: p.brand });
    return NextResponse.json({
      product: { id: p.id, productCode: p.productCode, title: p.title, priceNow: p.priceNow, poa },
      results: results.map((r) => ({
        ...r,
        canApply: !poa && APPLIABLE.has(r.sourceId) && r.status === "ok" && r.matchConfidence >= 1 && !r.aiRead && r.price !== p.priceNow,
        canRemovePrice: !poa && r.sourceId === "euronics" && r.status === "no_offer" && r.matchConfidence >= 1 && p.priceNow !== null,
        removable: r.sourceId.startsWith("site:"),
      })),
    });
  } catch (e) {
    console.error("price-check", e);
    return NextResponse.json({ error: "The price check failed. Try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "price-check" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  if (!siteId.startsWith("site:")) return NextResponse.json({ error: "Only added sites can be removed" }, { status: 400 });
  try {
    const db = await getPrisma();
    // Switched off, not deleted: its observations stay as price history.
    await db.priceSource.update({ where: { id: siteId }, data: { enabled: false } });
    await writeAudit(db, { entityType: "priceSource", entityId: siteId, action: "price-check:remove-site", changedFields: ["enabled"], previousValue: { enabled: true }, newValue: { enabled: false }, changedBy: gate.admin.email });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not remove that site" }, { status: 500 });
  }
}
