import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { previewImport } from "@/lib/importer";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const db = await getPrisma(); return NextResponse.json(await previewImport(db)); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
