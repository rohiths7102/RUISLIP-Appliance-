import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { applyImport } from "@/lib/importer";
import { writeAudit } from "@/lib/audit";
import { buildIndex } from "@/lib/rag/index";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";
// An import rewrites ~1,600 products AND rebuilds the chatbot index — well past
// the 10s serverless default.
export const maxDuration = 300;
export async function POST() {
  const admin = await getAdmin(); if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getPrisma();
    const r = await applyImport(db, admin.email);
    // The import just changed prices/stock/descriptions wholesale — the chatbot
    // must not keep quoting the pre-import catalogue until a manual rebuild.
    let ragIndexed = 0;
    try { ragIndexed = (await buildIndex(db)).indexed; } catch { /* best effort — surfaced in the response */ }
    await writeAudit(db, { entityType: "sync", entityId: "import", action: "apply", changedFields: ["import", "rag-rebuild"], previousValue: {}, newValue: { ...r, ragIndexed }, changedBy: admin.email });
    revalidateStorefront();
    return NextResponse.json({ ...r, ragIndexed });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
