import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { adminHref } from "@/lib/admin-config";
import AdminShell from "@/components/admin/AdminShell";
import ChatbotAdmin from "@/components/admin/ChatbotAdmin";
import { Badge, Card, EmptyState, Notice, PageTitle, StatTile, type Tone } from "@/components/admin/ui";
import { channelOf } from "@/lib/marketing/channels";
export const metadata = { title: "Chatbot" };
export const dynamic = "force-dynamic";

/**
 * Admin → Chatbot: every question customers asked the website assistant and
 * what it answered, mapped to the products, brands and departments asked
 * about. The gaps come first — questions it couldn't answer, model codes the
 * shop doesn't list, people who left a number — because those are sales the
 * site is missing. Read-only view of ChatTurn; setup and a test box at the end.
 */
const OUTCOME: Record<string, [string, Tone]> = {
  answered: ["answered", "success"], corrected: ["fixed a code or price", "info"],
  unsure: ["couldn't answer", "warning"], no_match: ["found nothing", "warning"], fallback: ["AI unavailable", "danger"],
};
const GAP = new Set(["unsure", "no_match", "fallback"]);
// A phone number or email typed into the chat: someone who wants a reply.
const CONTACT = /(?:\+44\s?7|\b07)\d{3}\s?\d{3}\s?\d{3}\b|\b0\d{2,4}\s?\d{3,4}\s?\d{3,4}\b|[\w.+-]+@[\w-]+\.[\w.]{2,}/;
// Someone trying to talk the assistant out of its rules.
const PROBE = /ignore (?:all |the |your |previous |earlier )*(?:instructions|rules)|system prompt|you are now|jailbreak|developer mode|reveal (?:your|the) (?:instructions|prompt)/i;
const when = (d: Date) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const tally = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

export default async function AdminChatbot({ searchParams }: { searchParams: Promise<{ days?: string; show?: string; q?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const show = sp.show === "unanswered" ? "unanswered" : "";
  const q = String(sp.q || "").trim().toLowerCase().slice(0, 80);
  let turns: any[] = [], dbUp = true;
  try {
    const db = await getPrisma();
    turns = await db.chatTurn.findMany({ where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { createdAt: "asc" }, take: 5000 });
  } catch { dbUp = false; }

  const byConv = new Map<string, any[]>();
  for (const t of turns) byConv.set(t.conversationId, [...(byConv.get(t.conversationId) || []), t]);
  const conversations = [...byConv].map(([id, ts]) => ({
    id, turns: ts, last: ts[ts.length - 1].createdAt, page: ts[0].page, source: ts[0].source,
    test: ts.every((t) => t.source === "admin"),
    gap: ts.some((t) => GAP.has(t.outcome)),
    contact: ts.some((t) => CONTACT.test(t.question)),
    probe: ts.some((t) => PROBE.test(t.question)),
  })).sort((a, b) => +new Date(b.last) - +new Date(a.last));
  const shown = conversations.filter((c) => (!show || c.gap) && (!q || c.turns.some((t) => `${t.question} ${t.answer}`.toLowerCase().includes(q))));

  // The numbers are customers only: the owner's own tests are listed, not counted.
  const real = turns.filter((t) => t.source !== "admin");
  const realConvs = conversations.filter((c) => !c.test);
  const gaps = real.filter((t) => GAP.has(t.outcome));
  const named = real.filter((t) => Array.isArray(t.products) && t.products.length).length;
  const waits = real.map((t) => t.latencyMs).sort((a, b) => a - b);
  const typical = waits.length ? waits[Math.floor(waits.length / 2)] : 0;
  const products = tally(real.flatMap((t) => (Array.isArray(t.products) ? t.products : []).map((p: any) => `${p.code}\u0000${p.title}\u0000${p.url}`))).slice(0, 8);
  const brands = tally(real.map((t) => t.understood?.brand).filter(Boolean)).slice(0, 10);
  const departments = tally(real.map((t) => t.understood?.category).filter(Boolean)).slice(0, 10);
  const unlisted = tally(real.flatMap((t) => (Array.isArray(t.understood?.codes) ? t.understood.codes : [])
    .filter((c: any) => c.status === "near" || c.status === "none").map((c: any) => `${c.asked}\u0000${(c.codes || []).join(", ")}`))).slice(0, 10);
  const channels = tally(realConvs.map((c) => channelOf(c.source)));
  const link = (over: Record<string, string>) => `?${new URLSearchParams({ days: String(days), ...(show && { show }), ...(q && { q }), ...over })}`;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <AdminShell active="/admin/chatbot" email={admin.email}>
      <PageTitle actions={<div className="flex gap-1.5">{[7, 30, 90].map((d) => (
        <Link key={d} href={link({ days: String(d) })} aria-current={d === days ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${d === days ? "bg-navy text-paper" : "border border-navy/20 hover:border-blue"}`}>{d} days</Link>
      ))}</div>}>Chatbot</PageTitle>
      <p className="mt-1 text-sm text-muted">What customers ask the website assistant, what it told them, and what it couldn&apos;t answer — every conversation, mapped to the products asked about.</p>
      {!dbUp && <Notice tone="danger" className="mt-4">The database isn&apos;t answering.</Notice>}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Conversations" value={realConvs.length} hint={`last ${days} days`} />
        <StatTile label="Questions" value={real.length} />
        <StatTile label="Answered with a product" value={pct(named, real.length)} hint={`${named} of ${real.length}`} />
        <StatTile label="Couldn't answer" value={gaps.length} hint={gaps.length ? "listed below — each is a gap to fill" : "none"} />
        <StatTile label="Left a phone or email" value={realConvs.filter((c) => c.contact).length} hint="call them back" />
        <StatTile label="Typical reply" value={typical ? `${(typical / 1000).toFixed(1)}s` : "—"} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">What they ask about</h2>
          {!products.length && !brands.length && !departments.length ? <p className="mt-3 text-sm text-muted">Fills in as customers chat.</p> : (
            <>
              {products.length > 0 && (
                <ol className="mt-3 space-y-1.5 text-[13px]">
                  {products.map(([k, n]) => { const [code, title, url] = k.split("\u0000"); return (
                    <li key={k} className="flex items-baseline gap-2">
                      <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">{n}×</span>
                      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-blue-deep hover:underline" title={title}>{title}</a>
                      <Link href={`${adminHref("products")}?q=${encodeURIComponent(code)}`} className="ml-auto shrink-0 font-mono text-[11px] text-blue-deep hover:underline">{code}</Link>
                    </li>
                  ); })}
                </ol>
              )}
              {[["Brands", brands], ["Departments", departments]].map(([label, list]) => (list as [string, number][]).length > 0 && (
                <div key={label as string} className="mt-4">
                  <p className="text-[11.5px] font-semibold text-muted">{label as string}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{(list as [string, number][]).map(([name, n]) => <Badge key={name} tone="neutral">{name} · {n}</Badge>)}</div>
                </div>
              ))}
              {channels.length > 0 && <p className="mt-4 text-[12px] text-muted">Chatters came from: {channels.map(([c, n]) => `${c} ${n}`).join(" · ")}</p>}
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Model codes asked for that aren&apos;t listed</h2>
          <p className="mt-1 text-[12px] text-muted">Customers typed these exact codes. Add the product, or check it&apos;s not listed under another code.</p>
          {unlisted.length ? (
            <ul className="mt-3 divide-y divide-line text-[13px]">
              {unlisted.map(([k, n]) => { const [asked, near] = k.split("\u0000"); return (
                <li key={k} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                  <span className="font-mono font-semibold">{asked}</span>
                  <span className="text-[11.5px] text-muted">{n}×</span>
                  <span className="ml-auto text-[12px] text-muted">{near ? <>closest listed: {near.split(", ").map((c, i) => <span key={c}>{i > 0 && ", "}<Link href={`${adminHref("products")}?q=${encodeURIComponent(c)}`} className="font-mono text-blue-deep hover:underline">{c}</Link></span>)}</> : "nothing close"}</span>
                </li>
              ); })}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">None — every code customers typed is listed.</p>}
        </Card>
      </div>

      {gaps.length > 0 && (
        <Card className="mt-5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Couldn&apos;t answer · latest</h2>
          <ul className="mt-3 divide-y divide-line text-[13px]">
            {[...gaps].reverse().slice(0, 8).map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="font-mono text-[11px] text-muted">{when(t.createdAt)}</span>
                <Badge tone={OUTCOME[t.outcome]?.[1] ?? "neutral"}>{OUTCOME[t.outcome]?.[0] ?? t.outcome}</Badge>
                <a href={`#c-${t.conversationId}`} className="min-w-0 flex-1 truncate hover:text-blue-deep hover:underline">“{t.question}”</a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-bold uppercase tracking-wide text-blue-deep">Conversations</h2>
          {[["", "All"], ["unanswered", "Couldn't answer"]].map(([v, label]) => (
            <Link key={v} href={link({ show: v })} aria-current={v === show ? "page" : undefined} className={`rounded-full px-3 py-1 text-xs font-medium ${v === show ? "bg-navy text-paper" : "border border-navy/20 hover:border-blue"}`}>{label}</Link>
          ))}
          <form method="get" className="w-full sm:w-auto">
            <input type="hidden" name="days" value={days} />
            {show && <input type="hidden" name="show" value={show} />}
            <input name="q" defaultValue={q} placeholder="Search questions and answers" aria-label="Search conversations" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm sm:w-60" />
          </form>
        </div>
        {!shown.length ? <div className="mt-4"><EmptyState title={turns.length ? "Nothing matches." : "No conversations yet."} hint={turns.length ? undefined : "Every question asked in the website chat will appear here."} /></div> : (
          <div className="mt-3 divide-y divide-line">
            {shown.slice(0, 100).map((c) => (
              <details key={c.id} id={`c-${c.id}`} className="group py-3">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-[11px] text-muted">{when(c.last)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">“{c.turns[0].question}”</span>
                  <span className="text-[12px] text-muted">{c.turns.length} question{c.turns.length === 1 ? "" : "s"}</span>
                  {c.test ? <Badge tone="neutral">your test</Badge> : <Badge tone="neutral">{channelOf(c.source)}</Badge>}
                  {c.gap && <Badge tone="warning">couldn&apos;t answer</Badge>}
                  {c.contact && <Badge tone="success">left contact details</Badge>}
                  {c.probe && <Badge tone="danger">tried to override it</Badge>}
                </summary>
                <div className="mt-3 space-y-3">
                  {c.page && <p className="text-[11.5px] text-muted">Opened on <span className="font-mono">{c.page}</span></p>}
                  {c.turns.map((t) => (
                    <div key={t.id} className="space-y-1.5 text-[13px]">
                      <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue px-3 py-2 text-paper">{t.question}</p>
                      <div className="w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl border border-line bg-paper px-3 py-2">{t.answer}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <Badge tone={OUTCOME[t.outcome]?.[1] ?? "neutral"}>{OUTCOME[t.outcome]?.[0] ?? t.outcome}</Badge>
                        {(Array.isArray(t.products) ? t.products : []).map((p: any) => <a key={p.code} href={p.url} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-2 py-0.5 font-mono hover:border-blue">{p.code}</a>)}
                        {[t.understood?.brand, t.understood?.category, t.understood?.maxPrice ? `under £${t.understood.maxPrice}` : ""].filter(Boolean).map((x: string) => <span key={x}>· {x}</span>)}
                        <span className="ml-auto font-mono">{t.provider || "no AI"} · {(t.latencyMs / 1000).toFixed(1)}s</span>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {shown.length > 100 && <p className="pt-3 text-center text-[12px] text-muted">Showing the latest 100 of {shown.length}. Narrow it with the search or a shorter period.</p>}
          </div>
        )}
      </Card>

      <div className="mt-8"><ChatbotAdmin /></div>
    </AdminShell>
  );
}
