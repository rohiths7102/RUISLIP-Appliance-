import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import BrandsAdmin from "@/components/admin/BrandsAdmin";
export const dynamic = "force-dynamic";
async function rows() {
  try { const db = await getPrisma(); const rs = await db.brand.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, logo: true, description: true, productCount: true, isVisible: true, order: true } }); if (rs.length) return rs; } catch {}
  const c = await loadCatalog();
  return c.brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, logo: b.logo, description: "", productCount: b.productCount, isVisible: true }));
}
export default async function AdminBrands() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/brands" email={admin.email}><BrandsAdmin initial={await rows()} /></AdminShell>;
}
