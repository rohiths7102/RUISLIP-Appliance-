import Link from "next/link";
import LogoutButton from "./LogoutButton";
import { usingDevPassword } from "@/lib/auth";
import { adminHref, SIGNIN_PATH } from "@/lib/admin-config";
import {
  LayoutDashboard, PackagePlus, Package, LayoutGrid, Tag, Megaphone,
  MessageCircle, Inbox, Store, RefreshCw, ArrowUpRight, type LucideIcon,
} from "lucide-react";

/**
 * The back office's own identity — a deep-navy rail with the shop's name on it,
 * grouped by what the owner is doing (sell / grow / run), and a live-storefront
 * card that says the quiet part out loud: every save here IS the website.
 * Distinct from the storefront (white/blue retail) on purpose: this is the
 * owner's control room, not another shop page.
 *
 * Nav is built from the (possibly secret) public admin path so links keep
 * working when ADMIN_PATH moves the panel off /admin. `active` is the internal
 * /admin/* key.
 */
const GROUPS: { title: string; items: [string, string, LucideIcon][] }[] = [
  { title: "Overview", items: [["", "Dashboard", LayoutDashboard]] },
  {
    title: "Sell",
    items: [
      ["products/new", "Add product", PackagePlus],
      ["products", "Products", Package],
      ["categories", "Categories", LayoutGrid],
      ["brands", "Brands", Tag],
    ],
  },
  {
    title: "Grow",
    items: [
      ["ads", "Google Ads", Megaphone],
      ["enquiries", "Sales & Leads", Inbox],
      ["chatbot", "Chatbot", MessageCircle],
    ],
  },
  {
    title: "Run",
    items: [
      ["settings", "Business", Store],
      ["sync", "Sync", RefreshCw],
    ],
  },
];

export default function AdminShell({ active, email, children }: { active: string; email: string; children: React.ReactNode }) {
  const activeSub = active.replace(/^\/admin\/?/, "");
  return (
    <div className="min-h-screen bg-paper-2/60">
      <div className="flex">
        {/* ---------------- rail ---------------- */}
        <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col overflow-y-auto bg-[linear-gradient(180deg,#0d2949_0%,#04101f_100%)] md:flex">
          <div className="px-5 pb-5 pt-6">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.3em] text-sky/70">Back office · est. 1977</p>
            <p className="mt-1.5 font-display text-[19px] font-semibold leading-tight tracking-tight text-white">
              Jyotsna Electrical
            </p>
          </div>

          <nav className="flex-1 px-3">
            {GROUPS.map((g) => (
              <div key={g.title} className="mb-4">
                <p className="px-2.5 pb-1.5 font-mono text-[8.5px] uppercase tracking-[0.26em] text-sky/50">{g.title}</p>
                {g.items.map(([sub, label, Icon]) => {
                  const current = activeSub === sub;
                  return (
                    <Link
                      key={sub}
                      href={adminHref(sub)}
                      aria-current={current ? "page" : undefined}
                      className={`group relative mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-200 ${
                        current ? "bg-white/10 font-semibold text-white" : "font-medium text-[#8fabce] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {/* active indicator — a sky bar, not a colour flood */}
                      <span className={`absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-sky transition-opacity ${current ? "opacity-100" : "opacity-0"}`} aria-hidden />
                      <Icon size={15} strokeWidth={2} className={current ? "text-sky" : "text-[#5f7fa3] transition-colors group-hover:text-sky"} aria-hidden />
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* the promise of the whole panel: saves here are live out there */}
          <div className="m-3 rounded-xl border border-white/10 bg-white/5 p-3.5">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-white">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Storefront is live
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[#8fabce]">
              Every save updates the website, the search and the chatbot within seconds.
            </p>
            <a href="/" target="_blank" rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-sky hover:text-white">
              Open shop front <ArrowUpRight size={11} aria-hidden />
            </a>
          </div>
        </aside>

        {/* ---------------- content column ---------------- */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-5 py-2.5">
              <Link href="/" className="hidden text-[12.5px] font-medium text-muted transition-colors hover:text-blue-deep md:block">
                ← View site
              </Link>
              {/* mobile: the rail collapses into a scrollable chip row */}
              <nav className="flex gap-1.5 overflow-x-auto md:hidden" aria-label="Admin sections">
                {GROUPS.flatMap((g) => g.items).map(([sub, label]) => (
                  <Link key={sub} href={adminHref(sub)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${activeSub === sub ? "bg-navy text-white" : "bg-paper-2 text-ink/70"}`}>
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="flex shrink-0 items-center gap-3 text-[12.5px]">
                <span className="hidden text-muted sm:block">{email}</span>
                <LogoutButton signinPath={SIGNIN_PATH} />
              </div>
            </div>
          </header>

          {/* This panel can create, edit and DELETE live products, so shipping it
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

          <main className="admin-fade mx-auto max-w-[1360px] p-5 lg:p-7">{children}</main>
        </div>
      </div>
    </div>
  );
}
