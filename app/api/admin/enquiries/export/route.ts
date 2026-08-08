import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { csvCell as esc } from "@/lib/csv-safe";
export const dynamic = "force-dynamic";

/** Excel reads "07/08/2026 14:30" as a date; a raw JS timestamp lands as text.
 *  Shop time is Europe/London whatever timezone the host runs in. */
const stamp = (v: unknown) =>
  v instanceof Date
    ? v.toLocaleString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "")
    : v;

export async function GET() {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });
  const db = await getPrisma();
  const rows = await db.enquiry.findMany({ orderBy: { createdAt: "desc" } });
  // The pipeline columns belong here too: notes and quotedPrice are the owner's
  // record of what he promised on the phone, and this export is their only way out.
  const head = ["createdAt", "status", "source", "productCode", "productTitle", "name", "email", "phone", "message", "notes", "quotedPrice", "lastEmailedAt"];
  const csv = [head.join(",")].concat(rows.map((r: any) => head.map((h) => esc(stamp(r[h]))).join(","))).join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=enquiries.csv" } });
}
