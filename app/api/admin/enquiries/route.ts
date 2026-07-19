import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  return NextResponse.json(await db.enquiry.findMany({ orderBy: { createdAt: "desc" } }));
}
export async function PATCH(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, status } = await req.json().catch(() => ({}));
  if (!id || !["new", "contacted", "closed"].includes(status)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const db = await getPrisma();
  return NextResponse.json(await db.enquiry.update({ where: { id }, data: { status } }));
}
