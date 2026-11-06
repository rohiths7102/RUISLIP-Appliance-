import { requireAdmin } from "@/lib/auth";
import { adminHref } from "@/lib/admin-config";
import { getPrisma } from "@/lib/prisma";
import { pricewireOverview } from "@/lib/price-watch/pricewire";
import AdminShell from "@/components/admin/AdminShell";
import PricewireAdmin from "@/components/admin/PricewireAdmin";
import PricewireAI from "@/components/admin/PricewireAI";
export const metadata = { title: "Pricewire" };
export const dynamic = "force-dynamic";

export default async function AdminPricewire() {
  const admin = await requireAdmin();
  const data = await pricewireOverview(await getPrisma());
  return (
    <AdminShell active="/admin/pricewire" email={admin.email}>
      <PricewireAdmin {...data} links={{ brands: adminHref("brands"), priceWatch: adminHref("price-watch") }} />
      <PricewireAI />
    </AdminShell>
  );
}
