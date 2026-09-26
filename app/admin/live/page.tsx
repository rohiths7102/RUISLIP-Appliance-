import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import LiveDashboard from "@/components/admin/LiveDashboard";
import { adminHref } from "@/lib/admin-config";
export const metadata = { title: "Live" };
export const dynamic = "force-dynamic";

/** Admin → Live: the site, Google and the sales pipeline as they happen (refreshes itself). */
export default async function LivePage() {
  const admin = await requireAdmin();
  return (
    <AdminShell active="/admin/live" email={admin.email}>
      <LiveDashboard salesHref={adminHref("enquiries")} />
    </AdminShell>
  );
}
