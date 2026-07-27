import Link from "next/link";
import LogoutButton from "./LogoutButton";
import { usingDevPassword } from "@/lib/auth";
import { adminHref, SIGNIN_PATH } from "@/lib/admin-config";

// Nav is built from the (possibly secret) public admin path so links keep working
// when ADMIN_PATH moves the panel off /admin. `active` is the internal /admin/* key.
const NAV: [string, string][] = [
  ["", "Overview"], ["products", "Products"], ["categories", "Categories"],
  ["brands", "Brands"], ["settings", "Business"], ["sync", "Sync"],
  ["chatbot", "Chatbot"], ["enquiries", "Enquiries"],
];
export default function AdminShell({ active, email, children }: { active: string; email: string; children: React.ReactNode }) {
  const activeSub = active.replace(/^\/admin\/?/, "");
  return (
    <div className="min-h-screen bg-paper">
      <div className="flex">
        <aside className="hidden w-56 shrink-0 border-r border-line bg-white md:block">
          <div className="p-4 font-display text-lg font-semibold">Admin<span className="text-blue">.</span></div>
          <nav className="flex flex-col px-2 pb-4 text-sm">
            {NAV.map(([sub, label]) => (
              <Link key={sub} href={adminHref(sub)} className={`rounded-lg px-3 py-2 ${activeSub === sub ? "bg-navy text-paper" : "text-muted hover:bg-paper-2"}`}>{label}</Link>
            ))}
          </nav>
        </aside>
        <div className="flex-1">
          <header className="flex items-center justify-between border-b border-line bg-white px-6 py-3">
            <Link href="/" className="text-sm text-muted hover:text-blue">← View site</Link>
            <div className="flex items-center gap-3 text-sm"><span className="text-muted">{email}</span><LogoutButton signinPath={SIGNIN_PATH} /></div>
          </header>
          {/* This panel can now create, edit and DELETE live products, so shipping it
              on the default password is a real risk — make that impossible to miss. */}
          {usingDevPassword() && (
            <div className="border-b-2 border-danger/30 bg-danger-soft px-6 py-3 text-sm text-danger">
              <strong>⚠ This admin is still on the default password (<code className="font-mono">admin</code>).</strong>
              <p className="mt-1 text-[13px] leading-relaxed">
                Anyone who reaches this page can change prices, upload files and delete your products.
                Fix it before sharing the site: run{" "}
                <code className="rounded bg-danger/10 px-1.5 py-0.5 font-mono text-xs">node scripts/hash-password.mjs &quot;your-password&quot;</code>,
                put the result in <code className="font-mono">.env</code> as{" "}
                <code className="font-mono">ADMIN_PASSWORD_HASH</code> (and set{" "}
                <code className="font-mono">ADMIN_EMAIL</code>), then restart.
              </p>
            </div>
          )}
          <main className="p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
