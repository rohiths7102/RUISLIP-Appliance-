"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, Notice } from "@/components/admin/ui";
import { uploadPhoto } from "@/lib/upload-photo";

/**
 * Admin → Homepage → Offers: the banner strip under the slideshow. The owner
 * adds a banner (upload, or paste its link), says a few words if he likes, and
 * the AI fills in what it offers and the page it opens; he checks, sets dates
 * if it's time-limited, and the page's Save puts it live.
 */
export type Offer = { id: string; enabled: boolean; href: string; alt: string; wide: string; mobile: string; bg: string; start: string; end: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const status = (o: Offer) =>
  !o.enabled ? "Hidden" : o.start && today() < o.start ? `Starts ${o.start}` : o.end && today() > o.end ? `Ended ${o.end}` : "Showing";

/** Average colour of the picture's outer edge, so the strip's padding matches it. "" if the browser can't read it. */
function edgeColour(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 16;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0, 64, 16);
        const d = x.getImageData(0, 0, 64, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < 16; y++) for (const xx of [0, 1, 62, 63]) { const i = (y * 64 + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
        resolve(`#${hex(r)}${hex(g)}${hex(b)}`);
      } catch { resolve(""); }
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

export default function OffersEditor({ offers, onChange }: { offers: Offer[]; onChange: (f: (o: Offer[]) => Offer[]) => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const patch = (i: number, p: Partial<Offer>) => onChange((l) => l.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i: number, d: number) => onChange((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function fill(i: number, wide: string, hint: string) {
    setBusy("Reading the banner…"); setErr(""); setNote("");
    const [s, bg] = await Promise.all([
      fetch("/api/admin/homepage/offer-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: wide, hint }) })
        .then((r) => r.json()).catch(() => null),
      wide ? edgeColour(wide) : Promise.resolve(""),
    ]);
    setBusy("");
    if (!s || s.error) { setErr(s?.error || "The AI didn't answer — fill it in yourself."); return; }
    patch(i, { alt: s.alt || offers[i]?.alt || "", href: s.href, ...(bg ? { bg } : {}) });
    setNote(s.via === "picture" ? "Filled in by AI from the banner. Check it, then Save."
      : s.via === "text" ? "Filled in by AI from your words (it can't read pictures until the Gemini key has credit). Check it, then Save."
      : "Matched from your words. Check it, then Save.");
  }

  async function upload(i: number, field: "wide" | "mobile", file: File | undefined) {
    if (!file) return;
    setBusy("Uploading…"); setErr("");
    try {
      const url = await uploadPhoto(file);
      patch(i, { [field]: url });
      setBusy("");
      if (field === "wide") await fill(i, url, offers[i]?.alt || "");
    } catch (e: any) { setBusy(""); setErr(`${e?.message || "Upload failed."} You can paste the banner's https:// link instead.`); }
  }

  const add = () => onChange((l) => [{ id: `offer-${Date.now()}`, enabled: true, href: "", alt: "", wide: "", mobile: "", bg: "#101920", start: "", end: "" }, ...l]);

  return (
    <section className="mt-5 space-y-4" aria-label="Offers">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink/80">The banner strip under the slideshow. Add a banner, and the AI fills in what it offers and which page it opens.</p>
        <Button small onClick={add}><Plus size={14} className="mr-1 inline" />Add an offer</Button>
      </Card>
      {busy && <Notice tone="info">{busy}</Notice>}
      {err && <Notice tone="danger">{err}</Notice>}
      {note && <Notice tone="success">{note}</Notice>}

      {offers.map((o, i) => (
        <Card key={o.id} className={`overflow-hidden ${!o.enabled ? "opacity-70" : ""}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-2/60 px-4 py-2.5">
            <span className="font-mono text-xs text-muted">Offer {i + 1}</span>
            <Badge tone={status(o) === "Showing" ? "success" : "neutral"}>{status(o)}</Badge>
            <div className="ml-auto flex items-center gap-1">
              <Button small variant="ghost" onClick={() => patch(i, { enabled: !o.enabled })}>
                {o.enabled ? <><EyeOff size={14} className="mr-1 inline" />Hide</> : <><Eye size={14} className="mr-1 inline" />Show</>}
              </Button>
              <button aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg p-1.5 text-ink/60 hover:bg-paper-2 disabled:opacity-25"><ArrowUp size={15} /></button>
              <button aria-label="Move down" onClick={() => move(i, 1)} disabled={i === offers.length - 1} className="rounded-lg p-1.5 text-ink/60 hover:bg-paper-2 disabled:opacity-25"><ArrowDown size={15} /></button>
              <button aria-label="Delete offer" onClick={() => { if (confirm(`Delete offer ${i + 1}?`)) onChange((l) => l.filter((_, j) => j !== i)); }} className="rounded-lg p-1.5 text-ink/60 hover:bg-danger-soft hover:text-danger"><Trash2 size={15} /></button>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {o.wide
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={o.wide} alt="" className="max-h-40 w-full rounded-lg object-contain" style={{ backgroundColor: o.bg }} />
              : <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No banner yet — upload it or paste its link below.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs font-medium text-ink/70">Banner (wide screens)
                <div className="mt-1 flex gap-2">
                  <input value={o.wide} onChange={(e) => patch(i, { wide: e.target.value.trim() })} placeholder="https://… or upload →" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-line px-3 text-sm hover:border-blue"><Upload size={14} />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(i, "wide", e.target.files?.[0])} /></label>
                </div>
              </label>
              <label className="block text-xs font-medium text-ink/70">Phone version <span className="font-normal text-muted">(optional)</span>
                <div className="mt-1 flex gap-2">
                  <input value={o.mobile} onChange={(e) => patch(i, { mobile: e.target.value.trim() })} placeholder="Leave empty to use the wide one" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-line px-3 text-sm hover:border-blue"><Upload size={14} />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(i, "mobile", e.target.files?.[0])} /></label>
                </div>
              </label>
            </div>
            <label className="block text-xs font-medium text-ink/70">What it offers <span className="font-normal text-muted">({o.alt.length}/160) — also what screen readers and Google read</span>
              <div className="mt-1 flex gap-2">
                <input value={o.alt} maxLength={160} onChange={(e) => patch(i, { alt: e.target.value })} placeholder="e.g. Liebherr — 10-year guarantee on all household appliances" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                <Button small variant="secondary" onClick={() => fill(i, o.wide, o.alt)} disabled={!!busy || (!o.wide && !o.alt)}><Sparkles size={14} className="mr-1 inline" />Fill in with AI</Button>
              </div>
            </label>
            <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
              <label className="block text-xs font-medium text-ink/70">Opens this page
                <input value={o.href} onChange={(e) => patch(i, { href: e.target.value.trim() })} placeholder="/brands/liebherr" className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-mono text-sm" />
              </label>
              <label className="block text-xs font-medium text-ink/70">From <span className="font-normal text-muted">(optional)</span>
                <input type="date" value={o.start} onChange={(e) => patch(i, { start: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-medium text-ink/70">Until <span className="font-normal text-muted">(optional)</span>
                <input type="date" value={o.end} onChange={(e) => patch(i, { end: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-medium text-ink/70">Edge colour
                <input type="color" value={o.bg} onChange={(e) => patch(i, { bg: e.target.value })} className="mt-1 h-[38px] w-14 rounded-lg border border-line" />
              </label>
            </div>
            {o.href && <a href={o.href} target="_blank" rel="noreferrer" className="text-xs text-blue-deep underline">Open {o.href} to check it ↗</a>}
          </div>
        </Card>
      ))}
    </section>
  );
}
