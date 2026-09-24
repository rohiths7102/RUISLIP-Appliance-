"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Button, Card } from "@/components/admin/ui";

/**
 * Admin → SEO: the pages Google shows but not near the top (position 4–15),
 * with their title and description editable in place. "Suggest" asks the AI
 * for a title and description built from the searches Google actually matched
 * this page to (Search Console, per page). Saves go through the normal
 * product / category admin routes, so they're audited like any other edit.
 */
export type SeoRow = {
  path: string; position: number; impressions: number; clicks: number;
  kind: "product" | "category"; id: string; name: string; seoTitle: string; seoDescription: string;
};
const TITLE_MAX = 60, DESC_MAX = 155;

export default function SeoEditor({ rows }: { rows: SeoRow[] }) {
  const [state, setState] = useState(() => Object.fromEntries(rows.map((r) => [r.path, { title: r.seoTitle, desc: r.seoDescription, savedTitle: r.seoTitle, savedDesc: r.seoDescription, saved: false, busy: "", err: "", queries: [] as string[] }])));
  const upd = (path: string, p: Partial<(typeof state)[string]>) => setState((s) => ({ ...s, [path]: { ...s[path], ...p } }));

  async function suggest(r: SeoRow) {
    upd(r.path, { busy: "suggest", err: "" });
    const res = await fetch("/api/admin/seo/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: r.kind, id: r.id, path: r.path }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { upd(r.path, { busy: "", err: j.error || "No suggestion — try again." }); return; }
    upd(r.path, { busy: "", title: j.title, desc: j.description, queries: j.queries || [], saved: false });
  }
  async function save(r: SeoRow) {
    const s = state[r.path];
    upd(r.path, { busy: "save", err: "" });
    const url = r.kind === "product" ? `/api/admin/products/${r.id}` : `/api/admin/categories/${r.id}`;
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seoTitle: s.title.trim(), seoDescription: s.desc.trim() }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    upd(r.path, res?.ok ? { busy: "", saved: true, err: "", savedTitle: s.title.trim(), savedDesc: s.desc.trim() } : { busy: "", saved: false, err: j.error || "Could not save." });
  }

  if (!rows.length) return null;
  return (
    <Card className="mt-6 p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Pages worth lifting · position 4–15</h2>
      <p className="mt-1 text-xs text-muted">
        Google already shows these; a sharper title (under {TITLE_MAX} characters, the product or department and the town first)
        and a description that answers the search (under {DESC_MAX}) is what moves them into the top three. Changes are live on the next visit.
      </p>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => {
          const s = state[r.path];
          const dirty = s.title.trim() !== s.savedTitle || s.desc.trim() !== s.savedDesc;
          return (
            <li key={r.path} className="grid gap-3 py-4 lg:grid-cols-[240px_1fr]">
              <div className="text-[13px]">
                <a href={r.path} target="_blank" rel="noreferrer" className="font-semibold hover:text-blue-deep">{r.name}</a>
                <span className="block truncate font-mono text-[11px] text-muted" title={r.path}>{r.path}</span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone={r.position <= 6 ? "warning" : "neutral"}>Google position {r.position.toFixed(1)}</Badge>
                  <Badge tone="neutral">{r.impressions} times shown · {r.clicks} clicks</Badge>
                </span>
                {s.queries.length > 0 && <p className="mt-2 text-[11.5px] text-muted">Searches: {s.queries.slice(0, 5).map((q) => `“${q}”`).join(", ")}</p>}
              </div>
              <div className="space-y-2">
                <label className="block text-[11.5px] font-semibold text-muted">Title <span className={`font-normal ${s.title.length > TITLE_MAX ? "text-danger" : ""}`}>({s.title.length}/{TITLE_MAX})</span>
                  <input value={s.title} onChange={(e) => upd(r.path, { title: e.target.value, saved: false })} placeholder="e.g. Bosch Series 4 Dishwasher — Delivered & Fitted in Ruislip"
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                </label>
                <label className="block text-[11.5px] font-semibold text-muted">Description <span className={`font-normal ${s.desc.length > DESC_MAX ? "text-danger" : ""}`}>({s.desc.length}/{DESC_MAX})</span>
                  <textarea value={s.desc} rows={2} onChange={(e) => upd(r.path, { desc: e.target.value, saved: false })} placeholder="What the page offers, the price if it helps, own-van delivery and fitting, the phone number"
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button small variant="secondary" onClick={() => suggest(r)} disabled={!!s.busy}><Sparkles size={13} className="mr-1 inline" />{s.busy === "suggest" ? "Thinking…" : "Suggest"}</Button>
                  <Button small onClick={() => save(r)} disabled={!!s.busy || !dirty}>{s.busy === "save" ? "Saving…" : "Save"}</Button>
                  {s.saved && <Badge tone="success">Saved — live</Badge>}
                  {s.err && <span className="text-xs text-danger">{s.err}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
