import { requireAdmin } from "@/lib/auth";
import { loadCatalog } from "@/lib/repo";
import { topCategories } from "@/lib/select";
import AdminShell from "@/components/admin/AdminShell";
import QuickAdd from "@/components/admin/QuickAdd";
export const dynamic = "force-dynamic";

export default async function AdminQuickAdd() {
  const admin = await requireAdmin();
  const { brands, categories } = await loadCatalog();
  return (
    <AdminShell active="/admin/products/new" email={admin.email}>
      <h1 className="font-display text-2xl font-semibold">Add a product</h1>
      <p className="mt-1 max-w-[560px] text-sm text-muted">
        The things only you know — photos, model code, price. Filing, brand pages,
        search and the chatbot are handled for you.
      </p>
      <div className="mt-6">
        <QuickAdd
          brands={brands.map((b) => b.name)}
          departments={topCategories(categories).map((c) => c.name)}
        />
      </div>
    </AdminShell>
  );
}
