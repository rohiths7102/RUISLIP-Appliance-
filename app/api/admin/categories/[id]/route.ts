import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncCategoryToRag, syncCategoryProductsToRag } from "@/lib/rag/index";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";
// A call-for-price flip rewrites the RAG doc of every product in the category
// (839 for the accessories department) — give the write room beyond the 10s default.
export const maxDuration = 60;
const EDITABLE = ["name", "image", "description", "seoTitle", "seoDescription", "isVisible", "order", "priceOnApplication"];
const TEXT = new Set(["name", "image", "description", "seoTitle", "seoDescription"]);
const FLAG = new Set(["isVisible", "priceOnApplication"]);
const pick = (o: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));

/**
 * Check the values before Prisma sees them. The name is not cosmetic: products
 * join categories by NAME string, so a blank one stamps "" onto all 813
 * accessories AND — when the category is call-for-price — puts "" into the
 * suppression set, which then matches every product that has no subcategory.
 * Returns an owner-readable message, or null when the body is safe to write.
 */
function reject(body: Record<string, unknown>): string | null {
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (TEXT.has(k)) {
      if (typeof v !== "string") return `${k} must be text.`;
      if (k === "name" && !v.trim()) return "Name cannot be empty — every product in this department is filed under it.";
    } else if (FLAG.has(k)) {
      if (typeof v !== "boolean") return `${k} must be a yes/no value.`;
    } else if (k === "order" && !Number.isInteger(v)) {
      return "Order must be a whole number.";
    }
  }
  return null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi(req);
  if ("response" in gate) return gate.response;
  const { admin } = gate;
  const { id } = await params; const body = await req.json().catch(() => ({}));
  const bad = reject(body); if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    const db = await getPrisma();
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data: Record<string, any> = {}; const changed: string[] = [];
    for (const k of EDITABLE) {
      if (!(k in body)) continue;
      // The name is the join key, so stray padding would fork it off the name
      // the products already carry.
      const v = k === "name" ? String(body[k]).trim() : body[k];
      if (v === (existing as any)[k]) continue;
      data[k] = v; changed.push(k);
    }
    if (!changed.length) return NextResponse.json(existing);
    const updated = await db.category.update({ where: { id }, data });
    // Products join categories by NAME string — a rename must carry them along
    // or the department page empties and call-for-price suppression silently
    // stops matching in the chatbot.
    if (changed.includes("name")) {
      await db.product.updateMany({ where: { category: existing.name }, data: { category: updated.name } });
      await db.product.updateMany({ where: { subcategory: existing.name }, data: { subcategory: updated.name } });
      const where = updated.parentId ? { subcategory: updated.name, isVisible: true } : { category: updated.name, isVisible: true };
      await db.category.update({ where: { id }, data: { productCount: await db.product.count({ where }) } });
    }
    await writeAudit(db, { entityType: "category", entityId: id, action: "update", changedFields: changed, previousValue: pick(existing, changed), newValue: pick(updated, changed), changedBy: admin.email });
    try { await syncCategoryToRag(db, id); } catch { /* reindex best-effort */ }
    // The flag governs what the chatbot may quote for every product in the
    // category — their docs must follow the toggle, not wait for a rag:build.
    // A rename re-keys the same lookup, so it needs the resync too.
    if (changed.includes("priceOnApplication") || changed.includes("name")) {
      try { await syncCategoryProductsToRag(db, id); } catch { /* reindex best-effort */ }
    }
    revalidateStorefront([`/categories/${id}`]);
    return NextResponse.json(updated);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
