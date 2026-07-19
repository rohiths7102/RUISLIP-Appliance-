import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { groqConfigured } from "@/lib/chat/groq";
import { embeddingsEnabled } from "@/lib/rag/embed";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let documents = 0, lastBuilt: any = null;
  try { const db = await getPrisma(); documents = await db.rAGDocument.count(); const latest = await db.rAGDocument.findFirst({ orderBy: { updatedAt: "desc" } }); lastBuilt = latest?.updatedAt || null; } catch {}
  return NextResponse.json({ documents, lastBuilt, groqConfigured: groqConfigured(), embeddings: embeddingsEnabled() });
}
