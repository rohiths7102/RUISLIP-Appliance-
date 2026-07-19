import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import SyncAdmin from "@/components/admin/SyncAdmin";
export const dynamic = "force-dynamic";
export default async function AdminSync() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/sync" email={admin.email}><SyncAdmin /></AdminShell>;
}
