import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { checkRule, runRules } from "@/lib/price-watch/pricing-rules";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pricing rules (lib/price-watch/pricing-rules.ts). GET lists them; POST adds
 * one, or with { action: "run" } runs them all now; PATCH changes one;
 * DELETE removes one. Every change is audit-logged. Running only fills the
 * review queue — nothing here changes a price.
 */
export async function GET(req: Request) {
  const gate = await requireAdminApi(req, { limit: 60, bucket: "pricewire-rules" });
  if ("response" in gate) return gate.response;
  const db = await getPrisma();
  return NextResponse.json({ rules: await db.pricingRule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }) });
}

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "pricewire-rules" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  if (body?.action === "run") return NextResponse.json(await runRules(db, gate.admin.email));
  const v = checkRule(body);
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
  const rule = await db.pricingRule.create({ data: v });
  await writeAudit(db, { entityType: "pricewire-rule", entityId: rule.id, action: "pricewire:rule-add", changedFields: ["*"], previousValue: {}, newValue: v, changedBy: gate.admin.email });
  return NextResponse.json({ ok: true, rule });
}

export async function PATCH(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000, bucket: "pricewire-rules" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  const before = await db.pricingRule.findUnique({ where: { id: String(body?.id || "") } });
  if (!before) return NextResponse.json({ error: "No such rule." }, { status: 404 });
  const v = checkRule({ ...before, ...body });
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
  const rule = await db.pricingRule.update({ where: { id: before.id }, data: v });
  const changed = Object.keys(v).filter((k) => (before as any)[k] !== (v as any)[k]);
  if (changed.length) await writeAudit(db, { entityType: "pricewire-rule", entityId: before.id, action: "pricewire:rule-edit", changedFields: changed,
    previousValue: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])), newValue: Object.fromEntries(changed.map((k) => [k, (v as any)[k]])), changedBy: gate.admin.email });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000, bucket: "pricewire-rules" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  const before = await db.pricingRule.findUnique({ where: { id: String(body?.id || "") } });
  if (!before) return NextResponse.json({ error: "No such rule." }, { status: 404 });
  await db.pricingRule.delete({ where: { id: before.id } });
  await writeAudit(db, { entityType: "pricewire-rule", entityId: before.id, action: "pricewire:rule-remove", changedFields: ["*"], previousValue: { name: before.name }, newValue: {}, changedBy: gate.admin.email });
  return NextResponse.json({ ok: true });
}
