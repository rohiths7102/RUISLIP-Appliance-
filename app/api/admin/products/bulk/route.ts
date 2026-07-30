import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { AVAILABILITY } from "@/lib/admin-product";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";

/**
 * Bulk operations over selected products — the owner shouldn't click 40 times
 * to mark a delivery's worth of stock. Everything is validated, audited and
 * re-indexed exactly like single edits.
 *
 * actions:
 *   set_stock     { value: AvailabilityNormalised }
 *   adjust_price  { value: percent, e.g. 5 or -10 }  (skips products with no price)
 *   set_visible   { value: boolean }
 *   set_featured  { value: boolean }
 */
const MAX_IDS = 200;

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 40, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  const admin = gate.admin;
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === "string") : [];
  const action = String(body.action || "");

  if (!ids.length) return NextResponse.json({ error: "No products selected" }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `Too many at once (max ${MAX_IDS})` }, { status: 400 });

  try {
    const db = await getPrisma();
    const rows = await db.product.findMany({ where: { id: { in: ids } } });
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let updated = 0, skipped = 0;
    for (const r of rows) {
      const data: Record<string, any> = {};
      const overrides = new Set<string>(((r.adminOverrideFields as string[]) || []));

      if (action === "set_stock") {
        const v = String(body.value);
        if (!AVAILABILITY.includes(v)) return NextResponse.json({ error: "Invalid stock state" }, { status: 400 });
        if (r.availabilityNormalised === v) { skipped++; continue; }
        data.availabilityNormalised = v;
        overrides.add("availabilityNormalised");
      } else if (action === "adjust_price") {
        const pct = Number(body.value);
        if (!Number.isFinite(pct) || Math.abs(pct) > 90)
          return NextResponse.json({ error: "Percentage must be a number between -90 and 90" }, { status: 400 });
        if (r.priceNow === null) { skipped++; continue; }
        const next = Math.max(0.01, Math.round(r.priceNow * (1 + pct / 100) * 100) / 100);
        data.priceNow = next;
        if (typeof r.priceWas === "number" && r.priceWas > next) data.saving = Math.round((r.priceWas - next) * 100) / 100;
        else data.saving = null;
        overrides.add("priceNow");
      } else if (action === "set_visible") {
        data.isVisible = Boolean(body.value);
      } else if (action === "set_featured") {
        data.featured = Boolean(body.value);
      } else {
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
      }

      data.adminOverrideFields = [...overrides];
      data.lastUpdatedByAdmin = new Date();
      await db.product.update({ where: { id: r.id }, data });
      try { await syncProductToRag(db, r.id); } catch { /* best effort */ }
      updated++;
    }

    await writeAudit(db, {
      entityType: "product", entityId: `bulk:${ids.length}`, action: `bulk:${action}`,
      changedFields: [action], previousValue: { ids }, newValue: { value: body.value, updated, skipped },
      changedBy: admin.email,
    });
    if (updated) revalidateStorefront();
    return NextResponse.json({ ok: true, updated, skipped });
  } catch (e) {
    console.error("bulk products", e);
    return NextResponse.json({ error: "Bulk update failed. Is the database running?" }, { status: 500 });
  }
}
