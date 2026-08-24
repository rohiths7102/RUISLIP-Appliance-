import { requireAdmin } from "@/lib/auth";
import { adminHref } from "@/lib/admin-config";
import AdminShell from "@/components/admin/AdminShell";
import ScrapeAdmin from "@/components/admin/ScrapeAdmin";

export const dynamic = "force-dynamic";

/**
 * Owner-facing page for reading a product page and turning it into a product.
 *
 * `adminHref` is resolved HERE, on the server: ADMIN_PATH is a private env var,
 * so the same call inside the client bundle would silently fall back to "/admin"
 * and produce dead links on a deployment that has moved the panel elsewhere.
 */
export default async function AdminScrapePage() {
  const admin = await requireAdmin();
  return (
    <AdminShell active="/admin/scrape" email={admin.email}>
      <ScrapeAdmin adminBase={adminHref()} />
    </AdminShell>
  );
}
