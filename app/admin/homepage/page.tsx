import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import HomepageAdmin from "@/components/admin/HomepageAdmin";
import { PageTitle } from "@/components/admin/ui";
export const dynamic = "force-dynamic";

export default async function AdminHomepage() {
  const admin = await requireAdmin();
  return (
    <AdminShell active="/admin/homepage" email={admin.email}>
      <PageTitle>Homepage</PageTitle>
      <div className="mt-5"><HomepageAdmin /></div>
    </AdminShell>
  );
}
