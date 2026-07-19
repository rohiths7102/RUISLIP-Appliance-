import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { applyImport } from "@/lib/importer";
import { writeAudit } from "@/lib/audit";
export const dynamic = "force-dynamic";
export async function POST() {
  const admin = await getAdmin(); if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getPrisma();
    const r = await applyImport(db, admin.email);
    await writeAudit(db, { entityType: "sync", entityId: "import", action: "apply", changedFields: ["import"], previousValue: {}, newValue: r, changedBy: admin.email });
    return NextResponse.json(r);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
