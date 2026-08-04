import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import CategoriesAdmin from "@/components/admin/CategoriesAdmin";
export const dynamic = "force-dynamic";
async function rows() {
  try {
    const db = await getPrisma();
    const rs = await db.category.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, image: true, description: true, seoTitle: true, seoDescription: true, productCount: true, isVisible: true, order: true, parentId: true, priceOnApplication: true } });
    if (rs.length) return rs;
  } catch {}
  const c = await loadCatalog();
  return c.categories.map((x) => ({ id: x.id, name: x.name, slug: x.slug, image: x.image, description: x.description, seoTitle: x.seoTitle, seoDescription: x.seoDescription, productCount: x.productCount, isVisible: true, order: 0, parentId: x.parentCategory, priceOnApplication: !!x.priceOnApplication }));
}
export default async function AdminCategories() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/categories" email={admin.email}><CategoriesAdmin initial={await rows()} /></AdminShell>;
}
