"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ArrowDownRight, ExternalLink, Info } from "lucide-react";
import { Button, Card, Notice, PageTitle } from "@/components/admin/ui";

/* ------------------------------------------------------------------ types
 * The shape app/admin/price-watch/page.tsx normalises into. Everything the
 * table needs is precomputed on the server — including the "seen 2 days ago"
 * label, so a server/browser timezone difference can't cause a hydration
 * mismatch, and including the guard verdict, so the browser never gets to
 * decide what is safe to apply.
 */
export type PriceWatchGuards = {
  allowed: boolean;
  blocking: string[];
  warnings: string[];
  floor: number | null;
};

export type PriceWatchObservation = {
  sourceId: string;
  sourceLabel: string;
  sourceKind: string;
  /** Inc-VAT and comparable with our own price. Never the source's raw figure. */
  price: number | null;
  /** Exactly as the source stated it, on the source's own VAT basis. */
  rawPrice: number | null;
  /** True when `price` was grossed up from an ex-VAT quote. */
  vatConverted: boolean;
  deliveryCost: number | null;
  landedPrice: number | null;
  inStock: boolean | null;
  sourceUrl: string;
  status: string;
  observedAt: string;
  seenLabel: string;
  guards: PriceWatchGuards;
};

export type PriceWatchRow = {
  productId: string;
  title: string;
  productCode: string;
  brand: string;
  category: string;
  subcategory: string;
  slug: string;
  priceNow: number | null;
  costPrice: number | null;
  /** The inc-VAT floor: cost + minimum margin, or the explicit override. */
  floor: number | null;
  observations: PriceWatchObservation[];
};

export type PriceWatchSource = {
  id: string;
  label: string;
  kind: string;
  enabled: boolean;
  lastRunLabel: string;
  lastRunStatus: string;
};

type ApplyResult = {
  productId: string;
  productCode: string;
  title: string;
  status: "applied" | "refused" | "unchanged";
  from: number | null;
  to: number | null;
  reasons: string[];
};

/* -------------------------------------------------------- plain English
 * The owner never sees a guard key. Every code from lib/price-watch/guards.ts
 * is a sentence in shop language, not scraper language.
 *
 * Deliberately NOT guards.ts's own GUARD_REASONS: those are written for whoever
 * maintains the guards ("Source quotes ex-VAT but we advertise inc-VAT, and no
 * VAT conversion was applied"), which is the right text for a log and the wrong
 * text for the person who runs the shop. Codes the guards may add in future
 * fall back to a safe generic sentence — never the raw key.
 */
// Guard codes that gate only UNATTENDED application. A human at this screen may
// still Apply despite them — the reason is shown as advice, not a wall. Kept in
// step with AUTO_ONLY_BLOCKS in lib/price-watch/guards.ts (the server enforces
// the same split, so this only decides which button is enabled). Everything not
// here is a hard block (below cost, VAT-basis error, POA, unusable reading).
const AUTO_ONLY = new Set<string>([
  "no_floor_data", "unknown_delivery", "advisory_source", "stale_observation",
  "implausible_move", "unconfirmed_match", "source_auto_apply_disabled", "auto_apply_flag_unknown",
]);

const REASON: Record<string, string> = {
  // blocking
  below_floor: "Would sell below your floor price",
  no_floor_data: "No cost price set for this product",
  vat_basis_mismatch: "Their price is before VAT — not a like-for-like comparison",
  unknown_delivery: "Their delivery cost is unknown",
  advisory_source: "Price is from someone else's shop",
  poa_category: "This range is “call for price”",
  stale_observation: "This price is more than a week old",
  implausible_move: "Price jump is too big — looks like a bad reading",
  invalid_proposal: "The price we read back doesn't make sense",
  unusable_observation: "The last check on this product failed",
  unconfirmed_match: "We're not certain this is the same appliance",
  source_auto_apply_disabled: "This source isn't allowed to set your prices",
  poa_unknown: "We can't tell whether this range is “call for price”",
  // warnings
  no_current_price: "You don't show a price for this yet",
  out_of_stock: "They say it's out of stock",
  thin_margin: "This only just clears your floor price",
  price_increase: "This would put your price up",
  auto_apply_flag_unknown: "This source's permission setting is missing",
  low_confidence_source_url: "No link to their listing to check against",
  // this screen's own
  guard_error: "Safety checks could not run — not safe to apply",
  no_observation: "No price has been seen from this source yet",
  no_price: "The source did not report a price",
  not_found: "This product no longer exists",
};
const say = (key: string) => REASON[key] ?? "Held back by a safety check";

const money = (n: number | null | undefined) =>
  typeof n === "number" ? `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const round2 = (n: number) => Math.round(n * 100) / 100;

/* --------------------------------------------------------------- chips
 * Deliberately NOT the ui.tsx <Badge>: that is 10.5px uppercase mono, which is
 * right for a one-word status and unreadable for a sentence. Same token
 * palette, sentence-case, 4.5:1+ on its own tint.
 */
function ReasonChip({ reason, tone }: { reason: string; tone: "block" | "warn" }) {
  const cls =
    tone === "block"
      ? "border-danger/30 bg-danger-soft text-danger"
      : "border-warning/30 bg-warning-soft text-warning";
  return (
    <span title={reason} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-medium leading-tight ${cls}`}>
      {say(reason)}
    </span>
  );
}

/* --------------------------------------------------------------- gap maths */
type Gap = { abs: number; pct: number; under: boolean } | null;

/** Positive = they are dearer than us = we are UNDER-priced (money on the table). */
function gapOf(ourPrice: number | null, theirPrice: number | null): Gap {
  if (typeof ourPrice !== "number" || typeof theirPrice !== "number" || ourPrice <= 0) return null;
  const abs = round2(theirPrice - ourPrice);
  if (abs === 0) return null;
  return { abs, pct: (theirPrice - ourPrice) / ourPrice, under: abs > 0 };
}

export default function PriceWatchAdmin({
  rows,
  sources,
  dbUp,
}: {
  rows: PriceWatchRow[];
  sources: PriceWatchSource[];
  dbUp: boolean;
}) {
  const router = useRouter();
  // Default to the first authorised source: the only kind the guards will ever
  // let us copy a price from, so it is the useful view on arrival.
  const [sourceId, setSourceId] = useState<string>(
    () => sources.find((s) => s.kind === "authorised" && s.enabled)?.id ?? sources[0]?.id ?? "",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  const source = sources.find((s) => s.id === sourceId) ?? null;

  /* Every row, decorated against the chosen source and sorted by how much
     attention it needs: biggest money difference first, then rows we can't
     compare, then rows this source has never seen. */
  const view = useMemo(() => {
    const decorated = rows.map((r) => {
      const chosen = r.observations.find((o) => o.sourceId === sourceId) ?? null;
      const others = r.observations.filter((o) => o.sourceId !== sourceId);
      const gap = gapOf(r.priceNow, chosen?.price ?? null);
      const rawBlocking = !chosen
        ? ["no_observation"]
        : chosen.price === null
          ? ["no_price"]
          : chosen.guards.blocking;
      // Hard blockers stop a human; auto-only ones are shown as advice.
      const blocking = rawBlocking.filter((b) => !AUTO_ONLY.has(b));
      const advisories = rawBlocking.filter((b) => AUTO_ONLY.has(b));
      const canApply = Boolean(chosen && chosen.price !== null && blocking.length === 0);
      return { row: r, chosen, others, gap, blocking, advisories, warnings: chosen?.guards.warnings ?? [], canApply };
    });
    return decorated.sort((a, b) => {
      const rank = (x: typeof a) => (!x.chosen ? 2 : !x.gap ? 1 : 0);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return Math.abs(b.gap?.abs ?? 0) - Math.abs(a.gap?.abs ?? 0);
    });
  }, [rows, sourceId]);

  const appliable = view.filter((v) => v.canApply);
  const attention = view.filter((v) => v.gap).length;
  const selectable = new Set(appliable.map((v) => v.row.productId));
  // The apply route rejects a batch over MAX_IDS outright, so "select all" on a
  // long list would fail wholesale and apply nothing. Cap here and tell the
  // owner, rather than letting them confirm a batch that cannot succeed.
  const MAX_APPLY = 200;
  const allChosen = [...selected].filter((id) => selectable.has(id));
  const chosenIds = allChosen.slice(0, MAX_APPLY);
  const overCap = allChosen.length - chosenIds.length;
  const allSelected = appliable.length > 0 && appliable.every((v) => selected.has(v.row.productId));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) appliable.forEach((v) => n.delete(v.row.productId));
      else appliable.forEach((v) => n.add(v.row.productId));
      return n;
    });

  const pending = confirming
    ? view.filter((v) => confirming.includes(v.row.productId) && v.chosen && v.chosen.price !== null)
    : [];

  async function apply() {
    if (!confirming?.length || busy || !sourceId) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/price-watch/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: confirming, sourceId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setResults(j.results ?? []);
      setConfirming(null);
      setSelected(new Set());
      // Re-read from the server rather than patching local state: the route may
      // have refused rows the browser thought were fine.
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Could not apply those prices");
    } finally {
      setBusy(false);
    }
  }

  const appliedCount = results?.filter((r) => r.status === "applied").length ?? 0;
  const refused = results?.filter((r) => r.status === "refused") ?? [];

  return (
    <div>
      <PageTitle
        actions={
          sources.length > 1 ? (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Compare against
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSelected(new Set());
                }}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-blue"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.kind === "authorised" ? "" : " (someone else's shop)"}
                    {s.enabled ? "" : " — off"}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        Price watch
        {attention > 0 && (
          <span className="ml-2 text-sm font-normal text-muted">
            ({attention} price{attention === 1 ? "" : "s"} differ{attention === 1 ? "s" : ""})
          </span>
        )}
      </PageTitle>

      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
        What other shops are charging for the same appliances, newest reading first. Nothing here changes
        your website until you press Apply — and a price is only offered when every safety check passes.
      </p>

      {!dbUp && (
        <Notice tone="warning" className="mt-4">
          <strong>The database isn&apos;t running, so nothing here can be loaded or saved.</strong>
        </Notice>
      )}
      {err && (
        <Notice tone="danger" className="mt-4">
          {err}
        </Notice>
      )}

      {results && (
        <Notice tone={appliedCount ? "success" : "warning"} className="mt-4">
          <strong>
            {appliedCount
              ? `${appliedCount} price${appliedCount === 1 ? "" : "s"} updated — live on the site now.`
              : "Nothing was changed."}
          </strong>
          {refused.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px]">
              {refused.map((r) => (
                <li key={r.productId}>
                  <span className="font-mono text-xs">{r.productCode}</span> — {r.reasons.map(say).join("; ")}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setResults(null)} className="mt-2 text-[12px] font-semibold underline">
            Dismiss
          </button>
        </Notice>
      )}

      {source && (
        <p className="mt-4 text-[12px] text-muted">
          <strong className="font-semibold text-ink">{source.label}</strong> ·{" "}
          {source.kind === "authorised"
            ? "an authorised source — prices from here can be copied across"
            : "a comparison source — for information only, prices from here are never applied"}{" "}
          · {source.lastRunLabel}
          {source.lastRunStatus ? ` (${source.lastRunStatus})` : ""}
        </p>
      )}

      {/* ------------------------------------------------- empty state */}
      {rows.length === 0 || sources.length === 0 ? (
        <Card className="mt-5 px-6 py-10">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="font-display text-lg font-semibold">No prices have been collected yet</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Price watch fills up on its own once the collector starts reporting. Nothing to do here by hand.
            </p>
            <ol className="mt-5 space-y-3 text-left text-[13px] leading-relaxed text-ink/80">
              <li>
                <strong className="font-semibold">1. A source has to exist.</strong> Each shop or supplier we
                watch is one row in the <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[11px]">PriceSource</code>{" "}
                table, marked either <em>authorised</em> (prices may be copied across) or <em>advisory</em>
                {" "}(for information only).
                {sources.length > 0 && <> You currently have {sources.length}.</>}
              </li>
              <li>
                <strong className="font-semibold">2. The collector posts what it sees.</strong> It signs each
                reading with its own machine key and sends it to{" "}
                <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[11px]">/api/price-ingest/observations</code>.
                That key is separate from your admin login, so a collector can never edit the shop.
              </li>
              <li>
                <strong className="font-semibold">3. Readings appear here.</strong> Reload this page after the
                next run. If a source shows a failed last run, the collector — not this screen — is the thing
                to look at.
              </li>
            </ol>
          </div>
        </Card>
      ) : (
        <>
          {/* ------------------------------------------ selection bar */}
          {chosenIds.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-navy px-4 py-3 text-paper">
              <span className="text-sm font-semibold">
                {chosenIds.length} product{chosenIds.length === 1 ? "" : "s"} selected
              </span>
              {overCap > 0 && (
                <span className="text-xs text-sky">
                  Applying the first {MAX_APPLY} — apply these, then select the remaining {overCap}.
                </span>
              )}
              <button
                onClick={() => setConfirming(chosenIds)}
                disabled={busy}
                className="rounded-lg bg-blue px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                Apply selected
              </button>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-white/80 hover:text-white">
                Clear
              </button>
            </div>
          )}

          {/* ------------------------------------------------- table */}
          <Card className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-paper-2 text-left text-ink/70">
                <tr>
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={appliable.length === 0}
                      aria-label="Select every product that can be applied"
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Your price</th>
                  <th className="p-3">Their price</th>
                  <th className="p-3">Difference</th>
                  <th className="p-3">Can this be applied?</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {view.map(({ row, chosen, others, gap, blocking, warnings, canApply }) => {
                  const isSel = selected.has(row.productId);
                  // Colour is never the only signal: the words "You're cheaper" /
                  // "You're dearer" and the arrow carry the same meaning.
                  const edge = gap ? (gap.under ? "border-l-4 border-success" : "border-l-4 border-warning") : "border-l-4 border-transparent";
                  return (
                    <tr key={row.productId} className={`border-t border-line align-top ${edge} ${isSel ? "bg-blue/[.06]" : ""}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(row.productId)}
                          disabled={!canApply}
                          aria-label={`Select ${row.productCode}`}
                          className="cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>

                      <td className="p-3">
                        <div className="font-medium leading-tight">{row.title}</div>
                        <div className="mt-0.5 text-xs text-ink/70">
                          <span className="font-mono">{row.productCode}</span>
                          {row.brand ? ` · ${row.brand}` : ""}
                          {row.subcategory || row.category ? ` · ${row.subcategory || row.category}` : ""}
                        </div>
                      </td>

                      <td className="p-3 whitespace-nowrap">
                        {row.priceNow === null ? (
                          <span className="text-ink/70">Call for price</span>
                        ) : (
                          <span className="font-semibold">{money(row.priceNow)}</span>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted">
                          {typeof row.costPrice === "number" ? `cost ${money(row.costPrice)}` : "no cost price"}
                          {typeof row.floor === "number" ? ` · floor ${money(row.floor)}` : ""}
                        </div>
                      </td>

                      <td className="p-3 whitespace-nowrap">
                        {chosen && chosen.price !== null ? (
                          <>
                            <span className="font-semibold">{money(chosen.price)}</span>
                            <div className="mt-0.5 text-[11px] text-muted">
                              {chosen.seenLabel}
                              {typeof chosen.deliveryCost === "number"
                                ? ` · delivery ${money(chosen.deliveryCost)}`
                                : " · delivery unknown"}
                              {chosen.inStock === false ? " · out of stock" : ""}
                            </div>
                            {chosen.vatConverted && (
                              <div className="mt-0.5 text-[11px] text-muted">
                                their trade price {money(chosen.rawPrice)} + VAT
                              </div>
                            )}
                            {chosen.sourceUrl && (
                              <a
                                href={chosen.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-deep hover:underline"
                              >
                                See their listing <ExternalLink size={11} aria-hidden />
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-ink/70">Not seen</span>
                        )}
                        {others.length > 0 && (
                          <div className="mt-2 border-t border-line pt-1.5 text-[11px] leading-relaxed text-muted">
                            {others.map((o) => (
                              <div key={o.sourceId}>
                                {o.sourceLabel}: {money(o.price)} <span className="text-ink/70">· {o.seenLabel}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="p-3 whitespace-nowrap">
                        {gap ? (
                          <div className={gap.under ? "text-success" : "text-warning"}>
                            <div className="flex items-center gap-1 font-semibold">
                              {gap.under ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
                              {money(Math.abs(gap.abs))}
                              <span className="font-normal">({Math.abs(gap.pct * 100).toFixed(1)}%)</span>
                            </div>
                            <div className="mt-0.5 text-[11px] font-medium">
                              {gap.under ? "You're cheaper — money on the table" : "You're dearer than them"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink/70">—</span>
                        )}
                      </td>

                      <td className="p-3">
                        {canApply ? (
                          <span className="inline-flex items-center rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-[11.5px] font-medium text-success">
                            All checks passed
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {blocking.map((b) => (
                              <ReasonChip key={b} reason={b} tone="block" />
                            ))}
                          </div>
                        )}
                        {warnings.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {warnings.map((w) => (
                              <ReasonChip key={w} reason={w} tone="warn" />
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="p-3 text-right">
                        <Button
                          small
                          variant={canApply ? "primary" : "secondary"}
                          disabled={!canApply || busy}
                          onClick={() => setConfirming([row.productId])}
                          title={canApply ? undefined : blocking.map(say).join("; ")}
                        >
                          Apply
                        </Button>
                        {row.slug && (
                          <a
                            href={`/products/${row.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 inline-flex rounded p-2 text-ink/70 hover:text-blue-deep"
                            title="View on site"
                          >
                            <ExternalLink size={14} aria-hidden />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            A price is only offered when it comes from an authorised source, is recent, and still leaves your
            margin above the floor. Everything else is shown so you can decide by hand — the checks are never
            skipped for you.
          </p>
        </>
      )}

      {/* ------------------------------------------------ confirmation */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
          onClick={() => !busy && setConfirming(null)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-semibold">
              Change {pending.length} price{pending.length === 1 ? "" : "s"}?
            </h2>
            <p className="mt-1 text-sm text-muted">
              This goes live on the website straight away. Nothing has changed yet.
            </p>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-paper-2 text-left text-ink/70">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2">Now</th>
                    <th className="p-2">Becomes</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(({ row, chosen }) => (
                    <tr key={row.productId} className="border-t border-line align-top">
                      <td className="p-2">
                        <div className="font-medium leading-tight">{row.title}</div>
                        <div className="font-mono text-[11px] text-ink/70">{row.productCode}</div>
                      </td>
                      <td className="p-2 whitespace-nowrap text-ink/70">
                        {row.priceNow === null ? "Call for price" : money(row.priceNow)}
                      </td>
                      <td className="p-2 whitespace-nowrap font-semibold">{money(chosen!.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Every change is checked again on the server before it is saved, and written to the audit log
              against your name. If something has moved since this page loaded, that change will be refused
              and told to you.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={apply} disabled={busy || pending.length === 0}>
                {busy ? "Applying…" : `Yes, change ${pending.length} price${pending.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
