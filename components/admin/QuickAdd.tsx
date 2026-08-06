"use client";
import { useRef, useState } from "react";
import { Card, Button, Notice } from "@/components/admin/ui";
import { UploadCloud, X, Star, Check, Loader2, ArrowUpRight, Sparkles } from "lucide-react";

type Shot = { file: File; preview: string };
type Phase = "form" | "working" | "done";
type Step = { label: string; state: "wait" | "run" | "done" };

/**
 * The one-minute add. The owner gives the things only he knows — photos, model
 * code, price — and watches the machine do the rest, step by step, ending in a
 * live link. Deliberately no mention of slugs, taxonomies or caches: the steps
 * speak shop ("Filing it in the right department…").
 */
export default function QuickAdd({ brands, departments }: { brands: string[]; departments: string[] }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [brand, setBrand] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [priceNow, setPriceNow] = useState("");
  const [priceWas, setPriceWas] = useState("");
  const [availability, setAvailability] = useState("in_stock");
  const [dept, setDept] = useState("");
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; classified: { category: string; subcategory: string; auto: boolean } | null; brandCreated: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...shots];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/") || next.length >= 8) continue;
      next.push({ file: f, preview: URL.createObjectURL(f) });
    }
    setShots(next);
  };
  const removeShot = (i: number) => setShots((s) => s.filter((_, x) => x !== i));
  const makeMain = (i: number) => setShots((s) => [s[i], ...s.filter((_, x) => x !== i)]);

  const setStep = (i: number, state: Step["state"]) =>
    setSteps((s) => s.map((st, x) => (x === i ? { ...st, state } : st)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!brand.trim() || !code.trim() || !title.trim()) { setError("Brand, model code and product name are needed — everything else is optional."); return; }

    const plan: Step[] = [
      { label: shots.length ? `Uploading ${shots.length} photo${shots.length === 1 ? "" : "s"}` : "No photos (you can add them later)", state: "wait" },
      { label: dept ? `Filing under ${dept}` : "Filing it in the right department", state: "wait" },
      { label: "Updating the website, search and chatbot", state: "wait" },
    ];
    setSteps(plan);
    setPhase("working");

    try {
      // 1 — photos through the existing hardened upload route
      setStep(0, "run");
      const urls: string[] = [];
      for (const s of shots) {
        const fd = new FormData();
        fd.append("file", s.file);
        const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "A photo failed to upload");
        urls.push(j.url);
      }
      setStep(0, "done");

      // 2 + 3 — one call does the rest server-side
      setStep(1, "run");
      const r = await fetch("/api/admin/products/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: brand.trim(), productCode: code.trim(), title: title.trim(),
          priceNow: priceNow || null, priceWas: priceWas || null,
          availability, category: dept, shortDescription: desc, images: urls,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not create the product");
      setStep(1, "done");
      setStep(2, "run");
      // the server already revalidated; a beat of honesty, not theatre
      await new Promise((res) => setTimeout(res, 500));
      setStep(2, "done");
      setResult({ url: j.url, classified: j.classified, brandCreated: j.brandCreated });
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : "Something went wrong — nothing was published.");
    }
  }

  const reset = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.preview));
    setShots([]); setBrand(""); setCode(""); setTitle(""); setPriceNow(""); setPriceWas("");
    setDept(""); setDesc(""); setAvailability("in_stock"); setResult(null); setError(""); setPhase("form");
  };

  /* ---------------- done ---------------- */
  if (phase === "done" && result) {
    return (
      <Card className="mx-auto max-w-[560px] p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
          <Check size={26} className="text-success" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold">It&apos;s live on the site</h2>
        <p className="mx-auto mt-2 max-w-[420px] text-sm leading-relaxed text-muted">
          {result.classified
            ? <>Filed under <strong className="text-ink">{result.classified.category}{result.classified.subcategory ? ` › ${result.classified.subcategory}` : ""}</strong>{result.classified.auto ? " (worked out from your description)" : ""}. </>
            : <>It couldn&apos;t be filed automatically — open Products and pick a department when you get a minute. </>}
          {result.brandCreated ? "The brand is new, so it now has its own page too. " : ""}
          The search and the chatbot already know about it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <a href={result.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-medium text-paper hover:bg-navy-2">
            See it on the site <ArrowUpRight size={14} />
          </a>
          <Button variant="secondary" onClick={reset}>Add another</Button>
        </div>
      </Card>
    );
  }

  /* ---------------- working ---------------- */
  if (phase === "working") {
    return (
      <Card className="mx-auto max-w-[560px] p-8">
        <h2 className="font-display text-xl font-semibold">Putting it on the shelf…</h2>
        <ul className="mt-5 space-y-3.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              {s.state === "done" ? <Check size={17} className="shrink-0 text-success" />
                : s.state === "run" ? <Loader2 size={17} className="shrink-0 animate-spin text-blue-deep" />
                : <span className="h-[17px] w-[17px] shrink-0 rounded-full border-2 border-line" />}
              <span className={s.state === "wait" ? "text-muted" : "text-ink"}>{s.label}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  /* ---------------- form ---------------- */
  return (
    <form onSubmit={submit} className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-semibold">Brand</span>
            <input list="qa-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Bosch"
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 outline-none focus:border-blue" />
            <datalist id="qa-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label className="text-sm">
            <span className="font-semibold">Model code</span>
            <span className="ml-1.5 text-[11px] font-normal text-muted">on the box / energy label</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WGG254Z0GB"
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 font-mono text-[13px] uppercase outline-none focus:border-blue" />
          </label>
        </div>

        <label className="mt-4 block text-sm">
          <span className="font-semibold">Product name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="8kg 1400 Spin Washing Machine — White"
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 outline-none focus:border-blue" />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-semibold">Price</span>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">£</span>
              <input value={priceNow} onChange={(e) => setPriceNow(e.target.value)} inputMode="decimal" placeholder="429.99"
                className="w-full rounded-xl border border-line bg-white py-2.5 pl-7 pr-3.5 tabular-nums outline-none focus:border-blue" />
            </div>
          </label>
          <label className="text-sm">
            <span className="font-semibold">Was</span>
            <span className="ml-1.5 text-[11px] font-normal text-muted">optional</span>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">£</span>
              <input value={priceWas} onChange={(e) => setPriceWas(e.target.value)} inputMode="decimal" placeholder="499.99"
                className="w-full rounded-xl border border-line bg-white py-2.5 pl-7 pr-3.5 tabular-nums outline-none focus:border-blue" />
            </div>
          </label>
          <label className="text-sm">
            <span className="font-semibold">Availability</span>
            <select value={availability} onChange={(e) => setAvailability(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 outline-none focus:border-blue">
              <option value="in_stock">In stock</option>
              <option value="limited">Limited stock</option>
              <option value="awaiting_stock">Awaiting stock</option>
              <option value="call_to_confirm">Call to confirm</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-semibold">Department</span>
            <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-normal text-muted"><Sparkles size={11} /> auto if left blank</span>
            <select value={dept} onChange={(e) => setDept(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 outline-none focus:border-blue">
              <option value="">Work it out from the name</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-semibold">One line about it</span>
            <span className="ml-1.5 text-[11px] font-normal text-muted">optional — helps auto-filing &amp; the chatbot</span>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Integrated dishwasher with cutlery tray"
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 outline-none focus:border-blue" />
          </label>
        </div>

        {error && <Notice tone="danger" className="mt-4">{error}</Notice>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted">Goes live the moment you press the button — website, search and chatbot together.</p>
          <Button type="submit">Put it on the site</Button>
        </div>
      </Card>

      {/* ---------------- photos ---------------- */}
      <Card className="p-5">
        <p className="text-sm font-semibold">Photos</p>
        <p className="mt-0.5 text-[12px] text-muted">First one is the main shot. Up to 8 — JPG, PNG or WebP.</p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          className="mt-3 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line bg-paper-2/60 px-4 py-8 text-muted transition-colors hover:border-blue hover:text-blue-deep"
        >
          <UploadCloud size={22} aria-hidden />
          <span className="text-[13px] font-medium">Drop photos here or tap to choose</span>
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

        {shots.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {shots.map((s, i) => (
              <li key={s.preview} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.preview} alt="" className="h-full w-full object-contain p-1" />
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded-full bg-navy px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Main</span>
                )}
                <span className="absolute right-1 top-1 flex gap-1">
                  {i !== 0 && (
                    <button type="button" title="Make main photo" onClick={() => makeMain(i)}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-ink opacity-0 shadow transition-opacity group-hover:opacity-100">
                      <Star size={12} />
                    </button>
                  )}
                  <button type="button" title="Remove" onClick={() => removeShot(i)}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-danger opacity-0 shadow transition-opacity group-hover:opacity-100">
                    <X size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </form>
  );
}
