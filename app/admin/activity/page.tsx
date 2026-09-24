import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { adminHref } from "@/lib/admin-config";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Card, Notice, PageTitle } from "@/components/admin/ui";
export const metadata = { title: "Activity log" };
export const dynamic = "force-dynamic";

/**
 * Admin → Activity log: everything that changed, who changed it and when —
 * the owner's edits, the nightly price sync, the marketing engine, sales
 * reported to Google. Read-only view of AdminAuditLog with a filter and search.
 */
const PAGE = 50;
const TYPES: [string, string][] = [
  ["", "Everything"], ["product", "Products"], ["enquiry", "Leads"], ["google-ads", "Google Ads"],
  ["marketing", "Marketing engine"], ["homepage", "Homepage"], ["google", "Google connection"],
];
/** Plain words for the codes the owner sees most. */
const LABELS: Record<string, string> = {
  "marketing:auto-block": "Auto-blocked a search", "marketing:daily": "Daily engine run", "marketing:settings": "Changed engine settings",
  "price-watch:auto-apply": "Nightly price sync", "price-watch:apply": "Price changed in Price watch", "price-watch:manual-apply": "Price matched to Euronics", "price-watch:link-euronics": "Linked to Euronics pages", "catalogue:merge-duplicate": "Merged a duplicate listing", "catalogue:fix-code": "Corrected a model code",
  "price-list:apply": "Price from the Euronics price list", "price-list:upload": "Uploaded the Euronics price list", "seo:fix-titles": "Tidied Google titles", "price-update": "Price updated",
  "price-watch:source-toggle": "Switched a price source", "price-watch:source-create": "Added a price source",
  "price-check:add-site": "Added a price-check shop", "price-check:remove-site": "Removed a price-check shop",
  "ads:block_search": "Blocked a search", "ads:pause_keyword": "Paused a keyword", "ads:sale_reported": "Sale sent to Google Ads",
  "homepage:save": "Changed the homepage", "google:connect": "Connected Google", "email-sent": "Emailed a customer",
  "admin:scrape-apply": "Added from a web page", "csv-import": "Spreadsheet import", "warranty:normalise": "Tidied warranties",
  "bulk:set_stock": "Bulk: stock", "bulk:adjust_price": "Bulk: prices", "bulk:set_visible": "Bulk: shown / hidden",
  "bulk:set_featured": "Bulk: featured", "bulk:set_warranty": "Bulk: warranty",
  rebuild: "Rebuilt the chatbot's knowledge", apply: "Applied a catalogue import",
  update: "Edited", create: "Created", delete: "Deleted",
};
const tone = (action: string): "success" | "warning" | "danger" | "info" | "neutral" =>
  action.startsWith("marketing:auto") || action === "ads:sale_reported" ? "success"
    : action.includes("delete") ? "danger" : action.includes("price") ? "warning" : action.startsWith("ads:") ? "info" : "neutral";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const type = TYPES.some(([t]) => t === (sp.type || "")) ? sp.type || "" : "";
  // Action codes and ids are lowercase; Postgres "contains" is case-sensitive.
  const q = (sp.q || "").trim().toLowerCase().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  let rows: any[] = [], total = 0, dbUp = true;
  try {
    const db = await getPrisma();
    const where = {
      // The engine logs its Ads changes under "google-ads"; its filter follows the action instead.
      ...(type === "marketing" ? { action: { startsWith: "marketing:" } } : type ? { entityType: type } : {}),
      ...(q ? { OR: [{ action: { contains: q } }, { entityId: { contains: q } }, { changedBy: { contains: q } }] } : {}),
    };
    [rows, total] = await Promise.all([
      db.adminAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
      db.adminAuditLog.count({ where }),
    ]);
    // Names, not ids: a product's title (opening it in Products), a lead's name.
    const ids = (t: string) => [...new Set(rows.filter((a) => a.entityType === t && !String(a.entityId).includes(":")).map((a) => a.entityId as string))];
    const [products, leads] = await Promise.all([
      ids("product").length ? db.product.findMany({ where: { id: { in: ids("product") } }, select: { id: true, title: true, productCode: true } }) : [],
      ids("enquiry").length ? db.enquiry.findMany({ where: { id: { in: ids("enquiry") } }, select: { id: true, name: true } }) : [],
    ]);
    const names = new Map<string, { label: string; href?: string }>([
      ...products.map((p: any) => [p.id, { label: p.title, href: `${adminHref("products")}?q=${encodeURIComponent(p.productCode)}` }] as const),
      ...leads.map((l: any) => [l.id, { label: `${l.name} (lead)` }] as const),
    ]);
    rows = rows.map((a) => ({ ...a, named: names.get(a.entityId) }));
  } catch { dbUp = false; }
  const link = (over: Record<string, string | number>) => {
    const u = new URLSearchParams({ ...(type && { type }), ...(q && { q }), page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `?${u}`;
  };

  return (
    <AdminShell active="/admin/activity" email={admin.email}>
      <PageTitle count={total}>Activity log</PageTitle>
      <p className="mt-1 text-sm text-muted">Every change, by whom and when — yours, the nightly price sync's, the marketing engine's.</p>

      <form className="mt-4 flex flex-wrap items-center gap-2" method="get">
        {TYPES.map(([t, label]) => (
          <Link key={t} href={link({ type: t, page: 1 })} aria-current={t === type ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${t === type ? "bg-navy text-paper" : "border border-navy/20 hover:border-blue"}`}>{label}</Link>
        ))}
        {type && <input type="hidden" name="type" value={type} />}
        <input name="q" defaultValue={q} placeholder="Search action, id or who" aria-label="Search the activity log" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm sm:ml-auto sm:w-64" />
      </form>

      {!dbUp && <Notice tone="danger" className="mt-4">The database isn&apos;t answering.</Notice>}
      <Card className="mt-4 divide-y divide-line">
        {rows.map((a) => (
          <details key={a.id} className="group px-4 py-3">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-[11px] text-muted">{new Date(a.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <Badge tone={tone(a.action)}>{LABELS[a.action] ?? a.action}</Badge>
              <span className="text-muted">{a.entityType}</span>
              {a.named?.href ? <a href={a.named.href} className="truncate text-[12.5px] font-medium text-blue-deep hover:underline">{a.named.label}</a>
                : a.named ? <span className="truncate text-[12.5px] font-medium">{a.named.label}</span>
                : <span className="truncate font-mono text-[11px] text-ink/70">{a.entityId}</span>}
              <span className="ml-auto text-[12px] text-muted">{a.changedBy}</span>
            </summary>
            <div className="mt-2 grid gap-3 text-[12px] sm:grid-cols-2">
              <div><p className="mb-1 font-semibold text-muted">Before</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-2/70 p-2 font-mono text-[11px]">{JSON.stringify(a.previousValue, null, 1)}</pre></div>
              <div><p className="mb-1 font-semibold text-muted">After</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-2/70 p-2 font-mono text-[11px]">{JSON.stringify(a.newValue, null, 1)}</pre></div>
            </div>
          </details>
        ))}
        {dbUp && !rows.length && <p className="p-6 text-center text-sm text-muted">Nothing matches.</p>}
      </Card>
      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link href={link({ page: Math.max(1, page - 1) })} className={page === 1 ? "pointer-events-none opacity-40" : "text-blue-deep hover:underline"}>← Newer</Link>
          <span className="text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
          <Link href={link({ page: page + 1 })} className={page * PAGE >= total ? "pointer-events-none opacity-40" : "text-blue-deep hover:underline"}>Older →</Link>
        </div>
      )}
    </AdminShell>
  );
}
