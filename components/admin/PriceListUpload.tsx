"use client";
import { useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button, Card, Notice } from "@/components/admin/ui";

/**
 * Admin → Price watch: upload the Euronics price list Sachin is emailed, see
 * what it changes, apply it — the B2C prices go straight onto the website.
 * The work is in /api/admin/price-list and lib/price-list.ts.
 */
type Change = { slug: string; code: string; title: string; from: number | null; to: number };
type Summary = {
  applied: boolean; file: string; rows: number; priced: number; matched: number; notInCatalogue: number;
  unchanged: number; hidden: number; callForPrice: number; notApproved: number;
  changeCount: number; up: number; down: number; added: number; changes?: Change[];
};
const gbp = (n: number | null) => (n === null ? "no price" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function PriceListUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "apply">("");
  const [plan, setPlan] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  async function send(apply: boolean) {
    if (!file) return;
    setBusy(apply ? "apply" : "check"); setErr(""); if (!apply) setDone(null);
    const fd = new FormData();
    fd.append("file", file);
    if (apply) fd.append("apply", "1");
    const r = await fetch("/api/admin/price-list", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy("");
    if (!r?.ok) { setErr(j.error || "Upload failed — check the connection and try again."); return; }
    if (apply) { setDone(j); setPlan(null); } else setPlan(j);
  }

  return (
    <Card className="mt-5 p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Upload the Euronics price list</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        The workbook you&apos;re emailed (.xlsx), or a CSV with a model number column and a price column. Its B2C price is the
        customer price: check what it changes, then apply, and the website shows the new prices straight away.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx,.csv" aria-label="Price list file"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPlan(null); setDone(null); setErr(""); }}
          className="max-w-full text-[13px] file:mr-3 file:rounded-full file:border-0 file:bg-paper-2 file:px-3.5 file:py-1.5 file:text-[12px] file:font-semibold" />
        <Button small variant="secondary" onClick={() => send(false)} disabled={!file || !!busy}>
          <span className="inline-flex items-center gap-1.5">{busy === "check" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Check what changes</span>
        </Button>
      </div>

      {err && <Notice tone="danger" className="mt-3">{err}</Notice>}

      {plan && (
        <div className="mt-4">
          <p className="text-[13px]">
            <strong>{plan.changeCount} price{plan.changeCount === 1 ? "" : "s"} will change</strong>
            {plan.changeCount > 0 && <> ({plan.up} up, {plan.down} down{plan.added ? `, ${plan.added} newly priced` : ""})</>}
            {" · "}{plan.unchanged} already right · {plan.notInCatalogue} models on the list you don&apos;t sell online
            {plan.hidden ? ` · ${plan.hidden} hidden products left alone` : ""}
            {plan.callForPrice ? ` · ${plan.callForPrice} call-for-price, left alone` : ""}
          </p>
          {plan.notApproved > 0 && <p className="mt-1 text-[12px] text-muted">{plan.notApproved} of the list&apos;s models are marked &quot;B2C not approved&quot;; their list price is applied too.</p>}
          {!!plan.changes?.length && (
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead className="sticky top-0 bg-paper-2 text-left text-[11px] text-muted">
                  <tr><th className="px-3 py-2">Model</th><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Now</th><th className="px-3 py-2 text-right">Becomes</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {plan.changes.map((c) => (
                    <tr key={c.slug}>
                      <td className="px-3 py-1.5 font-mono text-[11.5px]">{c.code}</td>
                      <td className="max-w-[260px] truncate px-3 py-1.5"><a href={`/products/${c.slug}`} target="_blank" rel="noreferrer" className="hover:text-blue-deep hover:underline">{c.title}</a></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted">{gbp(c.from)}</td>
                      <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${c.from !== null && c.to < c.from ? "text-success" : ""}`}>{gbp(c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.changeCount > (plan.changes?.length || 0) && <p className="mt-1 text-[11.5px] text-muted">Showing the biggest {plan.changes?.length} changes of {plan.changeCount}.</p>}
          <div className="mt-3">
            <Button onClick={() => send(true)} disabled={!!busy || plan.changeCount === 0}>
              {busy === "apply" ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Applying…</span>
                : plan.changeCount ? `Apply ${plan.changeCount} price change${plan.changeCount === 1 ? "" : "s"}` : "Nothing to change"}
            </Button>
          </div>
        </div>
      )}

      {done && (
        <Notice tone="success" className="mt-3">
          Done — {done.changeCount} price{done.changeCount === 1 ? "" : "s"} changed on the website from {done.file}. Every change is in the Activity log.
        </Notice>
      )}
    </Card>
  );
}
