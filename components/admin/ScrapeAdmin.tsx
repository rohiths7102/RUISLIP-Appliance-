"use client";
/**
 * "Scrape a page" — paste a product link, see what we found, then decide.
 *
 * Written for the shop owner, not a developer: no jargon, no field names, and
 * nothing is saved until he presses a button that says what it will do. The
 * preview step exists precisely so the machine never quietly puts a wrong price
 * on the website.
 */
import { useState } from "react";
import { Badge, Button, Card, Notice, PageTitle } from "@/components/admin/ui";

type Found = {
  title: string;
  brand: string;
  productCode: string;
  gtin: string;
  price: number | null;
  currency: string;
  image: string;
  description: string;
  availabilityRaw: string;
  availabilityNormalised: string;
  source: "structured data" | "page tags";
};

type Match = { id: string; title: string; productCode: string; brand: string; slug: string; priceNow: number | null };

type Preview = { ok: true; mode: "preview"; url: string; found: Found; warnings: string[]; matchedProductId?: string; match: Match | null };

type ApplyResult = {
  ok: true;
  mode: "created" | "updated" | "unchanged";
  productId: string;
  slug: string;
  title: string;
  updated: { field: string; label: string; from: unknown; to: unknown }[];
  skipped: { field: string; label: string; reason: string }[];
  warnings: string[];
  message: string;
};

const money = (n: number | null | undefined, currency = "GBP") =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 2 }).format(n)
    : "no price";

/** Values come back as strings/numbers from the API; show them readably. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "number") return String(v);
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

const AVAILABILITY_WORDS: Record<string, string> = {
  in_stock: "In stock",
  limited: "Only a few left",
  awaiting_stock: "Coming soon",
  call_to_confirm: "Ring to check",
  unavailable: "Not available",
  unknown: "Not stated",
};

export default function ScrapeAdmin({ adminBase }: { adminBase: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"" | "lookup" | "create" | "update">("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function call(payload: { url: string; apply?: boolean; productId?: string }) {
    const r = await fetch("/api/admin/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data: any = null;
    try { data = await r.json(); } catch { /* empty or non-JSON body */ }
    if (!r.ok || !data?.ok) {
      throw new Error(
        data?.error ||
          (r.status === 401
            ? "You have been signed out. Sign in again and try once more."
            : r.status === 429
              ? "That is a lot of look-ups at once. Wait a minute and try again."
              : "Something went wrong. Please try again."),
      );
    }
    return data;
  }

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy("lookup"); setError(""); setResult(null); setPreview(null);
    try { setPreview(await call({ url: url.trim() })); }
    catch (err: any) { setError(err?.message || "Something went wrong. Please try again."); }
    finally { setBusy(""); }
  }

  async function apply(mode: "create" | "update") {
    if (!preview || busy) return;
    setBusy(mode); setError("");
    try {
      const res: ApplyResult = await call({
        url: preview.url,
        apply: true,
        // Say which one explicitly: without forceCreate the server re-matches
        // and edits the existing product, which is not what this button says.
        ...(mode === "update" && preview.match ? { productId: preview.match.id } : { forceCreate: true }),
      });
      setResult(res);
      setPreview(null);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy("");
    }
  }

  const found = preview?.found;

  return (
    <div className="max-w-3xl">
      <PageTitle>Scrape a page</PageTitle>
      <p className="mt-2 text-sm text-muted">
        Paste the address of a product page — from a supplier, a manufacturer, or another shop — and we will read it and
        show you what is on it. <strong className="text-ink">Nothing is saved until you say so.</strong>
      </p>

      {/* ------------------------------------------------------------- input */}
      <form onSubmit={lookup} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="scrape-url" className="sr-only">Product page address</label>
        <input
          id="scrape-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(ev) => setUrl(ev.target.value)}
          placeholder="https://example.co.uk/washing-machines/…"
          className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/30"
        />
        <Button type="submit" disabled={!url.trim() || busy !== ""}>
          {busy === "lookup" ? "Reading the page…" : "Look up"}
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted">
        The link must start with <code>https://</code> and be a public web page. Reading can take a few seconds.
      </p>

      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}

      {busy === "lookup" && (
        <Card className="mt-5 p-6">
          <p className="text-sm text-ink">Reading that page…</p>
          <p className="mt-1 text-xs text-muted">We give it up to 15 seconds to answer.</p>
        </Card>
      )}

      {/* ----------------------------------------------------------- preview */}
      {found && preview && (
        <>
          {preview.warnings.length > 0 && (
            <Notice tone="warning" className="mt-4">
              <ul className="list-disc space-y-1 pl-4">
                {preview.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Notice>
          )}

          <Card className="mt-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Here is what we found</h2>
              <Badge tone={found.source === "structured data" ? "success" : "warning"}>
                {found.source === "structured data" ? "From the page's own product data" : "From the page's headings only"}
              </Badge>
            </div>
            {found.source !== "structured data" && (
              <p className="mt-1.5 text-xs text-muted">
                This page did not publish proper product data, so we read its headings instead. Check every line below
                before you save it.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
              {found.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={found.image}
                  alt={found.title || "Product photo from the page"}
                  className="h-32 w-32 shrink-0 rounded-xl border border-line bg-paper-2 object-contain p-2"
                />
              ) : (
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl border border-line bg-paper-2 px-2 text-center text-xs text-muted">
                  No photo on that page
                </div>
              )}

              <dl className="min-w-0 flex-1 space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Name</dt>
                  <dd className="font-medium text-ink">{found.title || "— not on the page —"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <dt className="text-xs text-muted">Brand</dt>
                    <dd className="text-ink">{found.brand || "— not on the page —"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Model number</dt>
                    <dd className="font-mono text-[13px] text-ink">{found.productCode || "— not on the page —"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Price</dt>
                    <dd className="font-display text-lg font-semibold text-ink">{money(found.price, found.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Stock</dt>
                    <dd className="text-ink">{AVAILABILITY_WORDS[found.availabilityNormalised] || "Ring to check"}</dd>
                  </div>
                </div>
                {found.description && (
                  <div>
                    <dt className="text-xs text-muted">Description</dt>
                    <dd className="text-[13px] text-ink">{found.description.slice(0, 240)}{found.description.length > 240 ? "…" : ""}</dd>
                  </div>
                )}
              </dl>
            </div>

            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Read from <span className="break-all">{preview.url}</span>
            </p>
          </Card>

          {/* ------------------------------------------------ match + actions */}
          <Card className="mt-4 p-5">
            {preview.match ? (
              <>
                <h3 className="text-sm font-semibold text-ink">You already sell this one</h3>
                <p className="mt-1.5 text-sm text-ink">
                  <strong>{preview.match.title}</strong>{" "}
                  <span className="font-mono text-xs text-muted">({preview.match.productCode})</span> — currently{" "}
                  {money(preview.match.priceNow)}.
                </p>
                <p className="mt-2 text-[13px] text-muted">
                  Updating fills in only the blanks, plus the price. Anything you have typed yourself stays exactly as
                  you left it — we will list what was left alone.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => apply("update")} disabled={busy !== ""}>
                    {busy === "update" ? "Updating…" : "Update this product"}
                  </Button>
                  <Button variant="secondary" onClick={() => apply("create")} disabled={busy !== ""}>
                    {busy === "create" ? "Adding…" : "Add as a separate new product"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-ink">This is not in your products yet</h3>
                <p className="mt-1.5 text-[13px] text-muted">
                  We will create it with the details above. It will have no department until you pick one, so set that
                  next.
                </p>
                <div className="mt-4">
                  <Button onClick={() => apply("create")} disabled={busy !== ""}>
                    {busy === "create" ? "Creating…" : "Create product"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------ result */}
      {result && (
        <>
          <Notice tone={result.mode === "unchanged" ? "info" : "success"} className="mt-5">
            {result.message}
          </Notice>

          {result.warnings.length > 0 && (
            <Notice tone="warning" className="mt-3">
              <ul className="list-disc space-y-1 pl-4">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Notice>
          )}

          {result.updated.length > 0 && (
            <Card className="mt-3 p-5">
              <h3 className="text-sm font-semibold text-ink">What changed</h3>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {result.updated.map((u) => (
                  <li key={u.field} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-32 shrink-0 text-muted">{u.label}</span>
                    <span className="text-ink">{show(u.from)} → <strong>{show(u.to)}</strong></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.skipped.length > 0 && (
            <Card className="mt-3 p-5">
              <h3 className="text-sm font-semibold text-ink">Left alone</h3>
              <p className="mt-1 text-xs text-muted">We never overwrite something you have already set.</p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {result.skipped.map((s) => (
                  <li key={s.field} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-32 shrink-0 text-muted">{s.label}</span>
                    <span className="text-ink">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`${adminBase}/products?q=${encodeURIComponent(result.title)}`}
              className="rounded-full bg-navy px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-navy-2"
            >
              Open it in Products
            </a>
            <Button
              variant="secondary"
              onClick={() => { setResult(null); setPreview(null); setUrl(""); setError(""); }}
            >
              Look up another page
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
