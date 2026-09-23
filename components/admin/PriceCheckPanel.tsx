"use client";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { Badge, Button, Notice } from "@/components/admin/ui";

/**
 * "Check prices" for one product — see app/api/admin/price-check/route.ts.
 * Shows what Euronics, the brand site and any added site charge for this
 * model right now. "Use this price" goes through the guarded apply route; this
 * panel never sets a price by itself.
 */
type Result = {
  sourceId: string; label: string; kind: "euronics" | "brand" | "site"; url: string;
  price: number | null; status: "ok" | "no_offer" | "not_found" | "blocked" | "parse_failed";
  matchConfidence: number; note: string; aiRead: boolean;
  canApply: boolean; canRemovePrice: boolean; removable: boolean;
};
type Payload = { product: { id: string; productCode: string; title: string; priceNow: number | null; poa: boolean }; results: Result[] };

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const STATUS: Record<Result["status"], { tone: "success" | "warning" | "danger" | "neutral"; text: string }> = {
  ok: { tone: "success", text: "Price found" },
  no_offer: { tone: "warning", text: "Not on sale" },
  not_found: { tone: "neutral", text: "Not listed" },
  blocked: { tone: "danger", text: "Blocked" },
  parse_failed: { tone: "neutral", text: "No price" },
};

export default function PriceCheckPanel({ productId, onClose, onPriceChanged }: {
  productId: string; onClose: () => void; onPriceChanged: (price: number | null) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [site, setSite] = useState("");
  const [acting, setActing] = useState("");

  const check = useCallback(async (addSite?: string) => {
    setBusy(true); setErr(""); setMsg("");
    const r = await fetch("/api/admin/price-check", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, ...(addSite ? { addSite } : {}) }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) { setErr(j.error || "The price check failed. Try again."); return; }
    setData(j);
    if (addSite) setSite("");
  }, [productId]);

  useEffect(() => { check(); }, [check]);

  async function usePrice(res: Result) {
    setActing(res.sourceId); setErr(""); setMsg("");
    const r = await fetch("/api/admin/price-watch/apply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: [productId], sourceId: res.sourceId }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setActing("");
    const one = j.results?.[0];
    if (!r || !r.ok || !one) { setErr(j.error || "Could not apply that price."); return; }
    if (one.status === "applied") { setMsg(`Price set to ${gbp(one.to)} to match ${res.label}.`); onPriceChanged(one.to); check(); }
    else if (one.status === "unchanged") setMsg("Your price already matches.");
    else setErr(`Not applied: ${(one.reasons || []).join(", ") || "refused by the safety checks"}.`);
  }

  async function removePrice() {
    setActing("remove"); setErr(""); setMsg("");
    const r = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceNow: null }),
    }).catch(() => null);
    setActing("");
    if (!r || !r.ok) { setErr("Could not remove the price."); return; }
    setMsg("Price removed — the site now shows “Call for best pricing”.");
    onPriceChanged(null); check();
  }

  async function removeSite(res: Result) {
    if (!confirm(`Stop comparing prices against ${res.label}?`)) return;
    const r = await fetch("/api/admin/price-check", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: res.sourceId }),
    }).catch(() => null);
    if (!r || !r.ok) { setErr("Could not remove that site."); return; }
    setData((d) => d && { ...d, results: d.results.filter((x) => x.sourceId !== res.sourceId) });
  }

  const ours = data?.product.priceNow ?? null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Sparkles size={18} className="text-blue" /> Check prices</h2>
            {data && <p className="mt-0.5 text-sm text-ink/70"><span className="font-mono">{data.product.productCode}</span> · {data.product.title}</p>}
            {data && <p className="mt-1 text-sm">Your price: <b>{data.product.poa ? "Call for price (category)" : ours === null ? "Call for best pricing" : gbp(ours)}</b></p>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => check()} disabled={busy} aria-label="Check again" className="rounded p-1.5 text-ink/70 hover:text-ink disabled:opacity-40"><RefreshCw size={16} className={busy ? "animate-spin" : ""} /></button>
            <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-ink/70 hover:text-ink"><X size={18} /></button>
          </div>
        </div>

        {err && <Notice tone="danger" className="mt-3">{err}</Notice>}
        {msg && <Notice tone="success" className="mt-3">{msg}</Notice>}

        <div className="mt-4 overflow-x-auto">
          {busy && !data ? (
            <p className="py-8 text-center text-sm text-ink/60">Checking Euronics and your sites… a first check of a new site can take up to half a minute.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink/60"><th className="p-2">Site</th><th className="p-2">Price</th><th className="p-2">vs yours</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
              <tbody>
                {data?.results.map((r) => {
                  const diff = r.price !== null && ours !== null ? r.price - ours : null;
                  return (
                    <tr key={r.sourceId} className={`border-t border-line align-top ${busy ? "opacity-50" : ""}`}>
                      <td className="p-2">
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-blue">{r.label} <ExternalLink size={12} /></a>
                        <p className="mt-0.5 max-w-xs text-xs text-ink/60">{r.note}</p>
                      </td>
                      <td className="whitespace-nowrap p-2 font-semibold">
                        {r.price === null ? "—" : gbp(r.price)}
                        {r.aiRead && <span className="ml-1 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">AI · unverified</span>}
                      </td>
                      <td className="whitespace-nowrap p-2">{diff === null ? "—" : Math.abs(diff) < 0.01 ? <span className="text-success">same</span> : <span className={diff > 0 ? "text-ink/70" : "text-danger"}>{diff > 0 ? "+" : "−"}{gbp(Math.abs(diff))}</span>}</td>
                      <td className="p-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Badge>{r.status === "ok" && r.matchConfidence < 1 && <p className="mt-1 text-[11px] text-warning">not sure it’s the same model</p>}</td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {r.canApply && <Button small onClick={() => usePrice(r)} disabled={!!acting}>{acting === r.sourceId ? "Applying…" : "Use this price"}</Button>}
                        {r.canRemovePrice && <Button small variant="secondary" onClick={removePrice} disabled={!!acting}>{acting === "remove" ? "Removing…" : "Set to call for price"}</Button>}
                        {r.removable && <button onClick={() => removeSite(r)} aria-label={`Remove ${r.label}`} className="ml-1 rounded p-1.5 text-ink/50 hover:text-danger"><X size={14} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (site.trim()) check(site.trim()); }} className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Add a site to compare, e.g. ao.com"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm" aria-label="Website to compare" />
          <Button small type="submit" disabled={busy || !site.trim()}><Plus size={14} className="mr-1 inline" />Add site</Button>
        </form>
        <p className="mt-2 text-xs text-ink/60">
          Added sites are compared on every product. AI finds this model on a site the first time; after that the page is remembered.
          Only an exact Euronics read can set your price — other sites are for comparison.
        </p>
      </div>
    </div>
  );
}
