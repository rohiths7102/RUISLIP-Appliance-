import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { revalidateStorefront } from "@/lib/revalidate";
import { autoApplySource } from "@/lib/price-watch/auto-apply";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Apply these prices": the owner has seen the list of changes on the page
 * and approves it. The price agent runs with the owner as the authority (see
 * autoApplySource `approvedBy`): first prices go on from one read and there is
 * no change budget, but call-for-price brands and categories, wrong-model and
 * VAT checks still hold. Every change is audit-logged under the owner's email.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 6, bucket: "pricewire-apply" });
  if ("response" in gate) return gate.response;
  const db = await getPrisma();
  const sites = await db.priceSite.findMany({ where: { enabled: true }, select: { id: true } });
  const result: Record<string, { applied: number; held: Record<string, number>; halted: string }> = {};
  let changed = 0;
  for (const { id } of sites as { id: string }[]) {
    const o = await autoApplySource(db, { sourceId: id, approvedBy: gate.admin.email });
    changed += o.applied.length;
    if (o.considered || o.halted) result[id] = { applied: o.applied.length, held: o.refused, halted: o.halted ? o.haltReason : "" };
  }
  if (changed) revalidateStorefront(["/products"], { allPages: true });
  return NextResponse.json({ changed, result });
}
