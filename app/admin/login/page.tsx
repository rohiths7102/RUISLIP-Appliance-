import { redirect } from "next/navigation";
import { SIGNIN_PATH } from "@/lib/admin-config";

// The login page moved to /admin/signin. Keep this as a permanent redirect so old
// bookmarks and the previous URL don't 404.
export default async function LegacyLogin({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  redirect(callbackUrl ? `${SIGNIN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}` : SIGNIN_PATH);
}
