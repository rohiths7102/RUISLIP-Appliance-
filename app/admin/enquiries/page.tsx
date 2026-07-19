import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import EnquiriesAdmin from "@/components/admin/EnquiriesAdmin";
export const dynamic = "force-dynamic";
export default async function AdminEnquiries() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/enquiries" email={admin.email}><EnquiriesAdmin /></AdminShell>;
}
