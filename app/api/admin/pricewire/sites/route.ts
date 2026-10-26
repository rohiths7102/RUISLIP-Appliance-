import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ensurePricewire, siteIdFrom } from "@/lib/price-watch/pricewire";
export const dynamic = "force-dynamic";

/**
 * The owner's sites (Admin → Pricewire → Sites). POST adds one, PATCH changes
 * one, DELETE removes one the owner added (built-in sites can be switched off,
 * not deleted, and a site a brand uses cannot go). A site's price source is
 * created with it — automatic, like every Pricewire site — so the price agent
 * can act on its reads the morning after it is added.
 *
 * An address must be https; a product-page address must say where the model
 * number goes ({code}), or every product would read the same page.
 */
const https = (u: string) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

function check(body: any): { name: string; kind: "list" | "page"; url: string } | string {
  const name = String(body?.name || "").trim().slice(0, 60);
  const kind = body?.kind === "list" ? "list" : body?.kind === "page" ? "page" : null;
  const url = String(body?.url || "").trim();
  if (!name) return "Give the site a name.";
  if (!kind) return "Choose a price list or product pages.";
  if (!https(url.replace(/\{code\}/gi, "X"))) return "The address must start with https://";
  if (kind === "page" && !/\{code\}/i.test(url)) return "A product-page address needs {code} where the model number goes.";
  return { name, kind, url };
}

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, bucket: "pricewire-sites" });
  if ("response" in gate) return gate.response;
  const v = check(await req.json().catch(() => ({})));
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
  const db = await getPrisma();
  await ensurePricewire(db);
  let id = siteIdFrom(v.name) || "site";
  for (let n = 2; await db.priceSite.findUnique({ where: { id } }); n++) id = `${siteIdFrom(v.name)}-${n}`;
  const site = await db.priceSite.create({ data: { id, ...v } });
  await db.priceSource.upsert({ where: { id }, update: {}, create: { id, label: v.name, kind: "authorised", priceIncludesVat: true, allowAutoApply: true, enabled: true } });
  await writeAudit(db, { entityType: "pricewire-site", entityId: id, action: "pricewire:site-add", changedFields: ["*"], previousValue: {}, newValue: v, changedBy: gate.admin.email });
  return NextResponse.json({ ok: true, site });
}

export async function PATCH(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, bucket: "pricewire-sites" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  const before = await db.priceSite.findUnique({ where: { id: String(body?.id || "") } });
  if (!before) return NextResponse.json({ error: "No such site." }, { status: 404 });
  const v = check({ name: body.name ?? before.name, kind: body.kind ?? before.kind, url: body.url ?? before.url });
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
  const data = { ...v, enabled: typeof body.enabled === "boolean" ? body.enabled : before.enabled };
  const site = await db.priceSite.update({ where: { id: before.id }, data });
  await db.priceSource.update({ where: { id: before.id }, data: { label: v.name, enabled: data.enabled } }).catch(() => null);
  const changed = Object.keys(data).filter((k) => (before as any)[k] !== (data as any)[k]);
  if (changed.length) {
    await writeAudit(db, { entityType: "pricewire-site", entityId: before.id, action: "pricewire:site-edit", changedFields: changed,
      previousValue: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])), newValue: Object.fromEntries(changed.map((k) => [k, (data as any)[k]])), changedBy: gate.admin.email });
  }
  return NextResponse.json({ ok: true, site });
}

export async function DELETE(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, bucket: "pricewire-sites" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  const site = await db.priceSite.findUnique({ where: { id: String(body?.id || "") } });
  if (!site) return NextResponse.json({ error: "No such site." }, { status: 404 });
  if (site.builtIn) return NextResponse.json({ error: "Built-in sites can be switched off, not removed." }, { status: 400 });
  const using = await db.brandPriceFeed.findMany({ where: { OR: [{ siteId: site.id }, { fallbackSiteId: site.id }] }, select: { brand: true } });
  if (using.length) return NextResponse.json({ error: `${using.map((u: any) => u.brand).join(", ")} still use this site. Change them first.` }, { status: 400 });
  await db.brandPriceItem.updateMany({ where: { siteId: site.id }, data: { siteId: "" } });
  await db.priceSite.delete({ where: { id: site.id } });
  // Its reads stay in Price watch history; the source is just switched off.
  await db.priceSource.update({ where: { id: site.id }, data: { enabled: false, allowAutoApply: false } }).catch(() => null);
  await writeAudit(db, { entityType: "pricewire-site", entityId: site.id, action: "pricewire:site-remove", changedFields: ["*"], previousValue: { name: site.name, url: site.url }, newValue: {}, changedBy: gate.admin.email });
  return NextResponse.json({ ok: true });
}
