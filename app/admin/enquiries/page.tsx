import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import SalesAdmin from "@/components/admin/SalesAdmin";
export const dynamic = "force-dynamic";
export default async function AdminEnquiries() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/enquiries" email={admin.email}><SalesAdmin /></AdminShell>;
}
