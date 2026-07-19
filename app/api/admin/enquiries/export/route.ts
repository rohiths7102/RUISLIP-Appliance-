import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
export async function GET() {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });
  const db = await getPrisma();
  const rows = await db.enquiry.findMany({ orderBy: { createdAt: "desc" } });
  const head = ["createdAt", "status", "source", "productCode", "productTitle", "name", "email", "phone", "message"];
  const csv = [head.join(",")].concat(rows.map((r: any) => head.map((h) => esc(r[h])).join(","))).join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=enquiries.csv" } });
}
