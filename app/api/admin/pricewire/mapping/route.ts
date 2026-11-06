import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { fetchPage } from "@/lib/page-reader";
import { brandsForSite, ensurePricewire } from "@/lib/price-watch/pricewire";
import { discover, priceCandidates, readBySelector, robotsAllows, pageNamesModel, NOT_FOUND_RETRY_DAYS } from "@/lib/price-watch/pricewire-map";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Admin → Pricewire → Mapping.
 *   GET ?siteId          the site's matches: counts, and the ones to confirm
 *   POST discover        find up to `limit` products on a search site now
 *   POST teach           list the £ prices on one of the site's product pages
 *   POST save-selector   keep the picked price location (checked on that page first)
 *   POST clear-selector  forget it
 *   PATCH                confirm or reject one match
 */
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function GET(req: Request) {
  const gate = await requireAdminApi(req, { limit: 60, bucket: "pricewire-mapping" });
  if ("response" in gate) return gate.response;
  const siteId = new URL(req.url).searchParams.get("siteId") || "";
  const db = await getPrisma();
  const site = await db.priceSite.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: "No such site." }, { status: 404 });
  const counts = Object.fromEntries((await db.productSiteLink.groupBy({ by: ["status"], where: { siteId }, _count: true })).map((g: any) => [g.status, g._count]));
  const review = await db.productSiteLink.findMany({ where: { siteId, status: "review" }, take: 100, orderBy: { updatedAt: "desc" },
    include: { product: { select: { productCode: true, title: true, brand: true, slug: true, priceNow: true } } } });
  return NextResponse.json({
    site: { id: site.id, name: site.name, kind: site.kind, url: site.url, priceSelector: site.priceSelector, selectorMisses: site.selectorMisses },
    counts, review: review.map((l: any) => ({ productId: l.productId, url: l.url, confidence: l.confidence, matchedBy: l.matchedBy, ...l.product })),
  });
}

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "pricewire-mapping" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  await ensurePricewire(db);
  const site = await db.priceSite.findUnique({ where: { id: String(body?.siteId || "") } });
  if (!site) return NextResponse.json({ error: "No such site." }, { status: 404 });

  if (body.action === "discover") {
    if (site.kind !== "search") return NextResponse.json({ error: "Only a search site finds products itself; product-page sites use {code}." }, { status: 400 });
    const limit = Math.min(30, Math.max(1, Number(body.limit) || 10));
    const brands = brandsForSite(site.id).filter((b) => !body.brand || b === body.brand);
    // Products matched already, or searched for and not found in the last 30 days, are skipped.
    const retryBefore = Date.now() - NOT_FOUND_RETRY_DAYS * 86_400_000;
    const have = new Set((await db.productSiteLink.findMany({ where: { siteId: site.id }, select: { productId: true, status: true, checkedAt: true } }))
      .filter((l: any) => l.status !== "none" || !l.checkedAt || new Date(l.checkedAt).getTime() > retryBefore).map((l: any) => l.productId));
    // The most valuable products first: an oven matters more than a filter.
    const todo = (await db.product.findMany({ where: { isVisible: true, brand: { in: brands.flatMap((b) => [b, b.toUpperCase()]) } }, select: { id: true, productCode: true, gtin: true, title: true, brand: true, priceNow: true } }))
      .filter((p: any) => !have.has(p.id)).sort((a: any, b: any) => (b.priceNow ?? 0) - (a.priceNow ?? 0)).slice(0, limit);
    const started = Date.now();
    const results: { code: string; status: string; url: string; matchedBy: string }[] = [];
    for (const p of todo) {
      if (Date.now() - started > 90_000) break;
      const d = await discover(site.url, { code: p.productCode, gtin: p.gtin, title: p.title, brand: p.brand });
      const data = d.found ? { url: d.url, confidence: d.confidence, matchedBy: d.matchedBy, status: d.status, checkedAt: new Date() }
        : { url: "", confidence: 0, matchedBy: d.reason.slice(0, 60), status: "none", checkedAt: new Date() };
      await db.productSiteLink.upsert({ where: { productId_siteId: { productId: p.id, siteId: site.id } }, update: data, create: { productId: p.id, siteId: site.id, ...data } });
      results.push({ code: p.productCode, status: data.status, url: data.url, matchedBy: data.matchedBy });
    }
    await writeAudit(db, { entityType: "pricewire-site", entityId: site.id, action: "pricewire:discover", changedFields: [], previousValue: {},
      newValue: { tried: results.length, auto: results.filter((r) => r.status === "auto").length, review: results.filter((r) => r.status === "review").length }, changedBy: gate.admin.email });
    return NextResponse.json({ results, left: Math.max(0, todo.length - results.length) });
  }

  if (body.action === "teach" || body.action === "save-selector") {
    const url = String(body.url || "").trim();
    const siteHost = host(site.url.replace(/\{code\}|\{q\}/gi, "x"));
    if (!/^https:\/\//i.test(url) || (siteHost && host(url) !== siteHost)) return NextResponse.json({ error: `Paste a product page from ${siteHost || "this site"} (https).` }, { status: 400 });
    if (!site.builtIn && !(await robotsAllows(url))) return NextResponse.json({ error: "This site's robots.txt asks us not to read that page." }, { status: 400 });
    let html: string;
    try { html = (await fetchPage(url)).html; } catch (e: any) { return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 502 }); }
    if (body.action === "teach") {
      const code = String(body.code || "").trim();
      return NextResponse.json({ candidates: priceCandidates(html).slice(0, 40), namesModel: code ? pageNamesModel(html, code) : null });
    }
    const selector = String(body.selector || "").trim().slice(0, 120);
    const price = readBySelector(html, selector);
    if (price === null) return NextResponse.json({ error: "That location shows no price on this page — pick another." }, { status: 400 });
    await db.priceSite.update({ where: { id: site.id }, data: { priceSelector: selector, selectorMisses: 0 } });
    await writeAudit(db, { entityType: "pricewire-site", entityId: site.id, action: "pricewire:teach-price", changedFields: ["priceSelector"],
      previousValue: { priceSelector: site.priceSelector }, newValue: { priceSelector: selector, sample: url, price }, changedBy: gate.admin.email });
    return NextResponse.json({ ok: true, selector, price });
  }

  if (body.action === "clear-selector") {
    await db.priceSite.update({ where: { id: site.id }, data: { priceSelector: "", selectorMisses: 0 } });
    await writeAudit(db, { entityType: "pricewire-site", entityId: site.id, action: "pricewire:teach-price", changedFields: ["priceSelector"], previousValue: { priceSelector: site.priceSelector }, newValue: { priceSelector: "" }, changedBy: gate.admin.email });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function PATCH(req: Request) {
  const gate = await requireAdminApi(req, { limit: 120, windowMs: 60_000, bucket: "pricewire-mapping" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const status = body?.status === "confirmed" ? "confirmed" : body?.status === "rejected" ? "rejected" : null;
  if (!status) return NextResponse.json({ error: "Confirm or reject." }, { status: 400 });
  const db = await getPrisma();
  const where = { productId_siteId: { productId: String(body.productId || ""), siteId: String(body.siteId || "") } };
  const before = await db.productSiteLink.findUnique({ where });
  if (!before) return NextResponse.json({ error: "No such match." }, { status: 404 });
  await db.productSiteLink.update({ where, data: { status } });
  // A confirmed match is read the next morning: make it due now.
  if (status === "confirmed") await db.brandPriceItem.updateMany({ where: { productId: before.productId }, data: { nextCheckAt: null } });
  await writeAudit(db, { entityType: "product", entityId: before.productId, action: `pricewire:match-${status}`, changedFields: [], previousValue: { status: before.status }, newValue: { status, site: before.siteId, url: before.url }, changedBy: gate.admin.email });
  return NextResponse.json({ ok: true });
}
