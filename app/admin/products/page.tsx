import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import { topCategories, childCategories } from "@/lib/select";
import AdminShell from "@/components/admin/AdminShell";
import ProductsAdmin from "@/components/admin/ProductsAdmin";
export const dynamic = "force-dynamic";

const SELECT = {
  id: true, title: true, brand: true, productCode: true, category: true, subcategory: true,
  priceNow: true, priceWas: true, availabilityNormalised: true, warranty: true,
  shortDescription: true, deliveryNotes: true, mainImage: true, slug: true, isVisible: true, featured: true,
  adminOverrideFields: true,
};

export default async function AdminProducts() {
  const admin = await requireAdmin();
  const { categories } = await loadCatalog();
  const catTree = topCategories(categories).map((c) => ({
    name: c.name,
    subs: childCategories(categories, c.id).map((s) => s.name),
  }));

  let rows: any[] = [];
  let total = 0;
  let dbUp = true;
  try {
    const db = await getPrisma();
    [rows, total] = await Promise.all([
      db.product.findMany({ orderBy: [{ lastUpdatedByAdmin: "desc" }, { title: "asc" }], take: 25, select: SELECT }),
      db.product.count(),
    ]);
  } catch {
    dbUp = false;
  }

  return (
    <AdminShell active="/admin/products" email={admin.email}>
      {!dbUp && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>The database isn&apos;t running, so nothing here can be saved.</strong>
          <p className="mt-1">
            The storefront is falling back to the bundled catalogue file. To enable editing, run{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">npx prisma migrate dev</code> then{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">npm run db:import</code>, and restart.
          </p>
        </div>
      )}
      <ProductsAdmin initial={rows} initialTotal={total} categories={catTree} />
    </AdminShell>
  );
}
