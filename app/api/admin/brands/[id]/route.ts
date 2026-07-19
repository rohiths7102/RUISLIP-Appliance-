import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncBrandToRag } from "@/lib/rag/index";
export const dynamic = "force-dynamic";
const EDITABLE = ["logo", "description", "isVisible"];
const pick = (o: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin(); if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params; const body = await req.json().catch(() => ({}));
  try {
    const db = await getPrisma();
    const existing = await db.brand.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data: Record<string, any> = {}; const changed: string[] = [];
    for (const k of EDITABLE) if (k in body && body[k] !== (existing as any)[k]) { data[k] = body[k]; changed.push(k); }
    if (!changed.length) return NextResponse.json(existing);
    const updated = await db.brand.update({ where: { id }, data });
    await writeAudit(db, { entityType: "brand", entityId: id, action: "update", changedFields: changed, previousValue: pick(existing, changed), newValue: pick(updated, changed), changedBy: admin.email });
    try { await syncBrandToRag(db, id); } catch { /* reindex best-effort */ }
    return NextResponse.json(updated);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
