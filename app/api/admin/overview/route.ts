import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  const [products, categories, brands, newEnquiries, lastJob] = await Promise.all([
    db.product.count(), db.category.count(), db.brand.count(), db.enquiry.count({ where: { status: "new" } }),
    db.scrapeJob.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  const missing = await db.product.findMany({ select: { priceNow: true, mainImage: true, availabilityNormalised: true } });
  return NextResponse.json({
    products, categories, brands, newEnquiries, lastScrape: lastJob,
    missingPrices: missing.filter((p: any) => p.priceNow === null).length,
    missingImages: missing.filter((p: any) => !p.mainImage).length,
    missingAvailability: missing.filter((p: any) => p.availabilityNormalised === "unknown").length,
  });
}
