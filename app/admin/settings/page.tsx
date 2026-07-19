import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import BusinessSettings from "@/components/admin/BusinessSettings";
export const dynamic = "force-dynamic";

async function businessForm() {
  try {
    const db = await getPrisma();
    const r = await db.businessInfo.findUnique({ where: { id: "business" } });
    if (r) return { businessName: r.businessName, tradingName: r.tradingName, phone: r.phone, email: r.email, deliveryRadius: r.deliveryRadius, mapQuery: r.mapQuery, googleMapsEmbedUrl: r.googleMapsEmbedUrl, address: r.address, openingHours: r.openingHours };
  } catch {}
  const b = (await loadCatalog()).business;
  return { businessName: b.businessName, tradingName: b.tradingName, phone: b.phone, email: b.email, deliveryRadius: b.delivery.radius, mapQuery: b.mapQuery, googleMapsEmbedUrl: b.googleMapsEmbedUrl, address: b.address, openingHours: b.openingHours };
}
export default async function AdminSettings() {
  const admin = await requireAdmin();
  const data = await businessForm();
  return <AdminShell active="/admin/settings" email={admin.email}><BusinessSettings initial={data} /></AdminShell>;
}
