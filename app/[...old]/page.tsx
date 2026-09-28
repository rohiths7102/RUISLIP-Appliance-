import { notFound, permanentRedirect } from "next/navigation";
import { loadCatalog } from "@/lib/repo";
import { oldAddressTarget } from "@/lib/old-urls";

// Checked per request: whether a product is still on the site changes daily.
export const dynamic = "force-dynamic";

/**
 * Every address no other route claims. The old site's pages Google still holds
 * are sent, permanently, to the product or department they now live at
 * (lib/old-urls.ts); anything else is the ordinary 404.
 */
export default async function OldAddress({ params }: { params: Promise<{ old: string[] }> }) {
  const { old } = await params;
  const target = oldAddressTarget(`/${old.join("/")}`, await loadCatalog());
  if (target) permanentRedirect(target);
  notFound();
}
