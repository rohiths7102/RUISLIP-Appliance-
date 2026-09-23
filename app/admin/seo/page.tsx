import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Card, EmptyState, PageTitle } from "@/components/admin/ui";
import { searchAnalytics, type GscRow } from "@/lib/search-console";
import { adminHref } from "@/lib/admin-config";
export const dynamic = "force-dynamic";

/**
 * Admin → SEO. Search Console over the "Connect Google" sign-in (lib/search-console.ts),
 * joined with the Google Ads search terms (AdsSnapshot) so paid and free
 * search are read together: where he pays for a click he'd get free, and
 * where searches cost money because the site doesn't rank.
 */
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export default async function AdminSeo() {
  const admin = await requireAdmin();
  let queries: GscRow[] | null = null, pages: GscRow[] | null = null, error = "", paid: any[] = [];
  try {
    const db = await getPrisma();
    [queries, pages] = await Promise.all([searchAnalytics(db, "query"), searchAnalytics(db, "page")]);
    paid = ((await db.adsSnapshot.findUnique({ where: { report: "searchTerms" } }).catch(() => null))?.rows as any[]) || [];
  } catch (e: any) {
    error = e?.message || "Search Console didn't answer.";
  }

  const organic = new Map((queries || []).map((q) => [norm(q.key), q]));
  const both = paid.filter((p) => p.clicks > 0).slice(0, 60).map((p) => ({ ...p, free: organic.get(norm(p.label)) }));

  return (
    <AdminShell active="/admin/seo" email={admin.email}>
      <PageTitle>SEO · Google search</PageTitle>
      <p className="mt-1 max-w-[680px] text-sm text-muted">
        What people search on Google when the site shows up in the free results (last 28 days, from Search Console),
        and how that sits alongside what you pay for in Google Ads.
      </p>

      {queries === null && !error && (
        <div className="mt-6"><EmptyState title="Search Console isn't connected yet."
          hint={`Connect Google on the Google Ads page (${adminHref("ads")}); the same sign-in covers Search Console.`} /></div>
      )}
      {error && <Card className="mt-6 p-5 text-sm text-danger">{error} Check the site is verified in Search Console under the same Google account.</Card>}

      {queries && (
        <>
          <Card className="mt-6 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Paid vs free, per search</h2>
            <p className="mt-1 text-xs text-muted">
              Searches your ads were clicked for, and where the site ranks for the same words for free. Ranking in the top 3 for free
              means the ad may be buying clicks you&apos;d get anyway; not ranking means the ad is the only way in.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-2">Search</th><th className="py-2 text-right">Ad clicks</th><th className="py-2 text-right">Ad spend</th><th className="py-2 text-right">Free position</th><th className="py-2 text-right">Free clicks</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {both.map((r) => (
                  <tr key={r.label}>
                    <td className="py-2">{r.label}</td>
                    <td className="py-2 text-right tabular-nums">{r.clicks}</td>
                    <td className="py-2 text-right tabular-nums">£{r.cost.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">{r.free ? r.free.position.toFixed(1) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.free ? r.free.clicks : 0}</td>
                    <td className="py-2 pl-3 text-right">
                      {r.free && r.free.position <= 3 ? <Badge tone="success">ranks free</Badge> : r.free ? <Badge tone="warning">page 1–2</Badge> : <Badge tone="neutral">ads only</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!both.length && <p className="py-4 text-center text-sm text-muted">Fills in once Google Ads has synced.</p>}
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {([["Top searches", queries], ["Top pages", pages || []]] as const).map(([title, list]) => (
              <Card key={title} className="p-5">
                <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">{title}</h2>
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-2">{title === "Top pages" ? "Page" : "Search"}</th><th className="py-2 text-right">Clicks</th><th className="py-2 text-right">Shown</th><th className="py-2 text-right">CTR</th><th className="py-2 text-right">Position</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {list.slice(0, 50).map((q) => (
                      <tr key={q.key}>
                        <td className="max-w-[260px] truncate py-2" title={q.key}>{title === "Top pages" ? q.key.replace(/^https?:\/\/[^/]+/, "") || "/" : q.key}</td>
                        <td className="py-2 text-right tabular-nums">{q.clicks}</td>
                        <td className="py-2 text-right tabular-nums">{q.impressions}</td>
                        <td className="py-2 text-right tabular-nums">{pct(q.ctr)}</td>
                        <td className="py-2 text-right tabular-nums">{q.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      )}
    </AdminShell>
  );
}
