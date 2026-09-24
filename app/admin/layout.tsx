import type { Metadata } from "next";
export const dynamic = "force-dynamic";
// Tabs read "Today · Back office"; and never indexed — robots.txt only covers
// /admin, not a secret ADMIN_PATH (listing that there would give it away).
export const metadata: Metadata = {
  title: { absolute: "Back office · Jyotsna Electrical", template: "%s · Back office" },
  robots: { index: false, follow: false },
};
/**
 * The marker says "this is the back office" to code that can't know the admin's
 * public URL (ADMIN_PATH can move it): globals.css hides the storefront's header,
 * strip, footer, chat and cookie bar under it, and the visitor tracker skips it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) { return <div data-admin-shell>{children}</div>; }
