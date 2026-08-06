import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { csvCell as esc } from "@/lib/csv-safe";
export const dynamic = "force-dynamic";

/** Full catalogue as CSV — the owner's backup / spreadsheet bulk-editing path. */
export async function GET() {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const db = await getPrisma();
    const rows = await db.product.findMany({ orderBy: [{ brand: "asc" }, { title: "asc" }] });
    const head = ["productCode", "brand", "title", "category", "subcategory", "priceNow", "priceWas", "availabilityNormalised", "warranty", "isVisible", "featured", "slug", "lastUpdatedByAdmin"];
    const csv = [head.join(",")]
      .concat(rows.map((r: any) => head.map((h) => esc(r[h])).join(",")))
      .join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=euronics-ruislip-products-${new Date().toISOString().slice(0, 10)}.csv`,
      },
    });
  } catch {
    return new Response("Database unavailable", { status: 500 });
  }
}
