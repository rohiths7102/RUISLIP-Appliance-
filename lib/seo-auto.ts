import { marketInsights } from "@/lib/price-watch/market";
import { suggestSeo } from "@/lib/seo-suggest";
import { groqConfigured } from "@/lib/chat/groq";
import { writeAudit } from "@/lib/audit";

/**
 * Daily SEO agent (owner, 15 Nov 2026): each morning, the pages on Pricewire →
 * Market's "SEO to fix" list (Google shows them low down, or people visit and
 * they have no search title) get a new Google title and description from the
 * AI, written from what people actually searched. Guard rails:
 *   - at most PER_DAY pages a day, worst first;
 *   - a page whose search text changed in the last REST_DAYS is left alone,
 *     so Google has time to show whether the last change worked;
 *   - the text must pass seoTextOk (length, no price, no "free"), else skipped;
 *   - every change is audited ("seo agent (daily)") and the page's updatedAt
 *     moves, so the daily IndexNow step asks search engines to re-read it.
 */
export const PER_DAY = 5;
export const REST_DAYS = 28;
const DAY = 86_400_000;

/** Search text safe to publish unattended: within Google's lengths, no price (prices change daily), no "free" (delivery and fitting are paid). */
export function seoTextOk(title: string, description: string): boolean {
  const t = String(title || "").trim(), d = String(description || "").trim();
  return t.length >= 15 && t.length <= 60 && d.length >= 50 && d.length <= 155 && !/£\s?\d/.test(t + " " + d) && !/\bfree\b/i.test(t + " " + d);
}

export async function runSeoAgent(db: any, opts: { perDay?: number; by?: string; budgetMs?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 40_000); // the daily job must still have time for its other steps
  if (!groqConfigured()) return { changed: [] as string[], note: "skipped: no AI key set" };
  const m = await marketInsights(db);
  const list = m.cards.filter((c) => c.jobs.seo).sort((a, b) => a.jobs.seo!.rank - b.jobs.seo!.rank);
  const since = new Date(Date.now() - REST_DAYS * DAY);
  const recent = new Set<string>((await db.adminAuditLog.findMany({
    where: { entityType: "product", entityId: { in: list.map((c) => c.id) }, createdAt: { gte: since } },
    select: { entityId: true, changedFields: true },
  })).filter((a: any) => Array.isArray(a.changedFields) && a.changedFields.includes("seoTitle")).map((a: any) => a.entityId));

  const changed: string[] = [], skipped: string[] = [];
  for (const c of list) {
    if (changed.length >= (opts.perDay ?? PER_DAY) || Date.now() > deadline) break;
    if (recent.has(c.id)) continue;
    let s: { title: string; description: string } | null = null;
    for (let i = 0; i < 3 && !(s && seoTextOk(s.title, s.description)); i++) s = await suggestSeo(db, "product", c.id, `/products/${c.slug}`).catch(() => null);
    if (!s || !seoTextOk(s.title, s.description)) { skipped.push(c.code); continue; }
    const before = await db.product.findUnique({ where: { id: c.id }, select: { seoTitle: true, seoDescription: true } });
    await db.product.update({ where: { id: c.id }, data: { seoTitle: s.title, seoDescription: s.description } });
    await writeAudit(db, {
      entityType: "product", entityId: c.id, action: "update", changedFields: ["seoTitle", "seoDescription"],
      previousValue: before, newValue: { seoTitle: s.title, seoDescription: s.description, why: c.jobs.seo!.why },
      changedBy: opts.by || "seo agent (daily)",
    });
    changed.push(c.code);
  }
  return { changed, skipped, note: `${changed.length} search titles rewritten${skipped.length ? `, ${skipped.length} skipped (the AI's text failed the checks)` : ""}; ${list.length} on the list` };
}
