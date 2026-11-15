import { callAssistant, groqConfigured } from "@/lib/chat/groq";
import { writeAudit } from "@/lib/audit";

/**
 * Did the price changes work? For each product whose price changed in the last
 * few weeks (any route: the price agent, Pricewire, a person's Apply), compare
 * its product-page views and call taps for the 7 days before the change with
 * the days after it, per day so a change 3 days old is fair against a full week.
 * Read from the database only: no Google call and no AI. The AI only writes the
 * short weekly note (writeEffectsNote) from these numbers.
 */
const DAY = 86_400_000;
export const EFFECT_WINDOW = 7;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type EffectKind = "down" | "up" | "first";
export type Verdict = "more" | "fewer" | "same" | "too_soon" | "quiet";
export type Effect = {
  id: string; code: string; slug: string; title: string; brand: string;
  at: string; from: number | null; to: number; kind: EffectKind;
  daysAfter: number;
  /** Per day, before and after the change. */
  viewsBefore: number; viewsAfter: number; callsBefore: number; callsAfter: number;
  verdict: Verdict;
};
export type Effects = {
  window: number;
  rows: Effect[];
  summary: Record<EffectKind, { n: number; more: number; fewer: number; viewsBefore: number; viewsAfter: number; callsBefore: number; callsAfter: number }>;
  note: { text: string; at: string; provider: string } | null;
};

/** Interest = views + 5 × call taps (a call is worth far more than a look). Needs 2 days after and a few visits to judge. */
export function verdictOf(e: { daysAfter: number; viewsBefore: number; viewsAfter: number; callsBefore: number; callsAfter: number }, window = EFFECT_WINDOW): Verdict {
  if (e.daysAfter < 2) return "too_soon";
  const before = e.viewsBefore + 5 * e.callsBefore, after = e.viewsAfter + 5 * e.callsAfter;
  // Total visits seen across both windows (rates back to counts): under 3 is noise.
  if ((e.viewsBefore + e.callsBefore) * window + (e.viewsAfter + e.callsAfter) * e.daysAfter < 3) return "quiet";
  if (after > before * 1.25 && after - before >= 0.3) return "more";
  if (after < before * 0.8 && before - after >= 0.3) return "fewer";
  return "same";
}

/** Per-day views and calls in [at − window, at) and [at, min(at + window, now)). */
export function compareWindows(events: { type: string; at: number }[], at: number, now: number, window = EFFECT_WINDOW) {
  const end = Math.min(at + window * DAY, now);
  const daysAfter = Math.max(0, (end - at) / DAY);
  let vb = 0, va = 0, cb = 0, ca = 0;
  for (const e of events) {
    const view = e.type === "page_view";
    if (e.at >= at - window * DAY && e.at < at) view ? vb++ : cb++;
    else if (e.at >= at && e.at < end) view ? va++ : ca++;
  }
  const per = (n: number, d: number) => (d > 0 ? round1(n / d) : 0);
  return { daysAfter: round1(daysAfter), viewsBefore: per(vb, window), viewsAfter: per(va, daysAfter), callsBefore: per(cb, window), callsAfter: per(ca, daysAfter) };
}

export async function priceEffects(db: any, opts: { lookbackDays?: number; window?: number } = {}): Promise<Effects> {
  const window = opts.window ?? EFFECT_WINDOW, now = Date.now();
  const since = new Date(now - (opts.lookbackDays ?? 30) * DAY);
  const audit: any[] = await db.adminAuditLog.findMany({
    where: { entityType: "product", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" }, select: { entityId: true, createdAt: true, previousValue: true, newValue: true },
  });
  // The newest price change per product: an older one is overlapped by it.
  const latest = new Map<string, { at: number; from: number | null; to: number }>();
  for (const a of audit) {
    const to = a.newValue?.priceNow, from = a.previousValue?.priceNow;
    if (typeof to !== "number" || latest.has(a.entityId)) continue;
    if (typeof from === "number" && Math.abs(from - to) < 0.01) continue;
    latest.set(a.entityId, { at: new Date(a.createdAt).getTime(), from: typeof from === "number" ? from : null, to });
  }
  const products: any[] = latest.size ? await db.product.findMany({
    where: { id: { in: [...latest.keys()] }, isVisible: true }, select: { id: true, productCode: true, slug: true, title: true, brand: true },
  }) : [];
  const events: any[] = products.length ? await db.trackedEvent.findMany({
    where: { type: { in: ["page_view", "call_click"] }, productSlug: { in: products.map((p) => p.slug) }, createdAt: { gte: new Date(since.getTime() - window * DAY) } },
    select: { type: true, productSlug: true, createdAt: true },
  }) : [];
  const bySlug = new Map<string, { type: string; at: number }[]>();
  for (const e of events) { const l = bySlug.get(e.productSlug) || []; l.push({ type: e.type, at: new Date(e.createdAt).getTime() }); bySlug.set(e.productSlug, l); }

  const blank = () => ({ n: 0, more: 0, fewer: 0, viewsBefore: 0, viewsAfter: 0, callsBefore: 0, callsAfter: 0 });
  const summary: Effects["summary"] = { down: blank(), up: blank(), first: blank() };
  const rows: Effect[] = [];
  for (const p of products) {
    const c = latest.get(p.id)!;
    const w = compareWindows(bySlug.get(p.slug) || [], c.at, now, window);
    const kind: EffectKind = c.from === null ? "first" : c.to < c.from ? "down" : "up";
    const verdict = verdictOf(w, window);
    rows.push({ id: p.id, code: p.productCode, slug: p.slug, title: p.title, brand: p.brand, at: new Date(c.at).toISOString(), from: c.from, to: c.to, kind, ...w, verdict });
    const s = summary[kind];
    s.n++; if (verdict === "more") s.more++; if (verdict === "fewer") s.fewer++;
    if (verdict !== "too_soon") { s.viewsBefore += w.viewsBefore; s.viewsAfter += w.viewsAfter; s.callsBefore += w.callsBefore; s.callsAfter += w.callsAfter; }
  }
  for (const s of Object.values(summary)) for (const k of ["viewsBefore", "viewsAfter", "callsBefore", "callsAfter"] as const) s[k] = round1(s[k]);
  // Products people noticed first, then the biggest swing in interest.
  const swing = (r: Effect) => Math.abs((r.viewsAfter + 5 * r.callsAfter) - (r.viewsBefore + 5 * r.callsBefore));
  rows.sort((a, b) => Number(b.verdict === "more" || b.verdict === "fewer") - Number(a.verdict === "more" || a.verdict === "fewer") || swing(b) - swing(a));

  const last = await db.adminAuditLog.findFirst({ where: { action: "pricewire:effects-note" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, newValue: true } });
  const note = last?.newValue?.text ? { text: String(last.newValue.text), at: new Date(last.createdAt).toISOString(), provider: String(last.newValue.provider || "") } : null;
  // The page shows the first few; 300 keeps the answer small (the summary counts every change).
  return { window, rows: rows.slice(0, 300), summary, note };
}

/** The numbers the AI sees: a few compact lines, so the note costs a few hundred tokens. */
export function effectsBrief(e: Effects, max = 12) {
  const gbp = (n: number | null) => (n === null ? "Call" : `£${n}`);
  const k = (s: Effects["summary"][EffectKind], name: string) =>
    `${name}: ${s.n} (more interest ${s.more}, less ${s.fewer}); views/day ${s.viewsBefore}→${s.viewsAfter}, calls/day ${s.callsBefore}→${s.callsAfter}`;
  const judged = e.rows.filter((r) => r.verdict !== "too_soon" && r.verdict !== "quiet").slice(0, max);
  return [
    k(e.summary.down, "Price cuts"), k(e.summary.up, "Price rises"), k(e.summary.first, "First prices on Call products"),
    "Products (code, brand, old→new, views/day before→after, calls/day before→after, verdict):",
    ...judged.map((r) => `${r.code} ${r.brand} ${gbp(r.from)}→${gbp(r.to)} views ${r.viewsBefore}→${r.viewsAfter} calls ${r.callsBefore}→${r.callsAfter} ${r.verdict}`),
  ].join("\n");
}

/** Haiku (or the next AI) writes the weekly note from effectsBrief: about 1k tokens in, 250 out. */
export async function writeEffectsNote(db: any, by = "pricewire (weekly note)") {
  if (!groqConfigured()) return { ok: false as const, note: "skipped: no AI key set" };
  const e = await priceEffects(db);
  if (!e.rows.some((r) => r.verdict === "more" || r.verdict === "fewer")) return { ok: false as const, note: "skipped: no change has enough visits to judge yet" };
  const { text, provider } = await callAssistant([
    { role: "system", content: "You advise the owner of a small UK appliance shop. From the numbers given ONLY, write at most 5 short bullet points in plain British English: which price changes brought more interest (views, call taps), which lost it, and one or two concrete next steps (e.g. keep a cut, reconsider a rise, promote a product). Name products by model code. Never invent a number or a reason that isn't in the data; say when the numbers are too small to be sure. No headings, no preamble." },
    { role: "user", content: effectsBrief(e) },
  ], { maxTokens: 300, timeoutMs: 30_000 });
  const clean = text.trim().slice(0, 1500);
  if (!clean) return { ok: false as const, note: "the AI returned nothing" };
  await writeAudit(db, { entityType: "pricewire", entityId: "effects", action: "pricewire:effects-note", changedFields: ["note"], previousValue: null, newValue: { text: clean, provider }, changedBy: by });
  return { ok: true as const, note: "written", text: clean, provider };
}
