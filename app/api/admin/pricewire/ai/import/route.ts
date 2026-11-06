import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { MAX_UPLOAD_BYTES, readDocument, stageDocument } from "@/lib/price-watch/pricewire-ai";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST multipart { file } — read the prices in any document (PDF, photo, Excel,
 * CSV, Word, text) and put the retail ones in the review queue. Nothing is
 * applied here; see lib/price-watch/pricewire-ai.ts.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 10, windowMs: 60_000, bucket: "pricewire-ai-import" });
  if ("response" in gate) return gate.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "That file is over 15 MB — split it or send a smaller copy." }, { status: 413 });
  try {
    const read = await readDocument(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!read.rows.length) return NextResponse.json({ error: "No model numbers with prices were found in that file.", kind: read.kind, notes: read.notes }, { status: 422 });
    const summary = await stageDocument(await getPrisma(), file.name, read, gate.admin.email);
    return NextResponse.json(summary);
  } catch (e) {
    console.error("pricewire ai import", e);
    return NextResponse.json({ error: (e as Error).message?.slice(0, 300) || "Couldn't read that file." }, { status: 400 });
  }
}
