import { requireAdmin } from "@/lib/auth";
import { adminHref } from "@/lib/admin-config";
import { getPrisma } from "@/lib/prisma";
import { pricewireOverview } from "@/lib/price-watch/pricewire";
import AdminShell from "@/components/admin/AdminShell";
import PricewireAdmin from "@/components/admin/PricewireAdmin";
import PricewireAI from "@/components/admin/PricewireAI";
import PricewireEngine from "@/components/admin/PricewireEngine";
export const metadata = { title: "Pricewire" };
export const dynamic = "force-dynamic";

export default async function AdminPricewire() {
  const admin = await requireAdmin();
  const db = await getPrisma();
  const data = await pricewireOverview(db);
  // For the pricing-rule form: the sources a rule can compare, and the brands and categories it can cover.
  const [sources, brandRows, categoryRows] = await Promise.all([
    db.priceSource.findMany({ where: { enabled: true, NOT: { id: { in: ["ai-assistant", "pricing-rules"] } } }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    db.product.findMany({ where: { isVisible: true }, distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } }),
    db.category.findMany({ where: { isVisible: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <AdminShell active="/admin/pricewire" email={admin.email}>
      <PricewireAdmin {...data} links={{ brands: adminHref("brands"), priceWatch: adminHref("price-watch") }} />
      <PricewireEngine sites={data.sites.map((s) => ({ id: s.id, name: s.name, kind: s.kind, url: s.url }))} sources={sources}
        brands={brandRows.map((b: any) => b.brand).filter(Boolean)} categories={[...new Set<string>(categoryRows.map((c: any) => c.name))]} />
      <PricewireAI />
    </AdminShell>
  );
}
