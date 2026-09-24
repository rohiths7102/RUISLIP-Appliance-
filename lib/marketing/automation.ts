import { writeAudit } from "@/lib/audit";
import { adsApiConfigured, blockSearch } from "@/lib/google-ads-api";
import { isNegated } from "@/lib/ads-reports";
import { blockedSearches, isBrandSearch } from "@/lib/marketing/engine";
import type { MarketingSettings } from "@/lib/marketing/settings";

/**
 * Nightly auto-block: the one change the engine may make to the Google Ads
 * account by itself, and only when the owner has switched it on. A search is
 * blocked (exact-match negative) only if ALL of these hold over the last 30 days:
 *   - it cost at least `autoBlockMinSpend`
 *   - it had at least 3 clicks (a real pattern, not one stray tap)
 *   - it produced no call or enquiry
 *   - it does not contain the shop's own name (those go to Today for a human)
 *   - the account's negatives don't already stop it
 * At most `autoBlockMaxPerDay` a night, dearest first. Every block is written
 * to the audit log as "marketing:auto-block" with the numbers that justified it.
 */
export const AUTO_MIN_CLICKS = 3;

export async function autoBlockCandidates(db: any, s: MarketingSettings) {
  const snaps = await db.adsSnapshot.findMany({ where: { report: { in: ["searchTerms", "negatives", "sharedNegatives"] } } }).catch(() => []);
  const rows = (name: string) => (snaps.find((x: any) => x.report === name)?.rows as any[]) || [];
  const negatives = [...rows("negatives"), ...rows("sharedNegatives")];
  const blocked = await blockedSearches(db);
  return rows("searchTerms")
    .filter((r) => r.cost >= s.autoBlockMinSpend && r.clicks >= AUTO_MIN_CLICKS && r.conversions === 0
      && !isBrandSearch(r.label) && !blocked.has(r.label.toLowerCase()) && !isNegated(r.label, negatives))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, s.autoBlockMaxPerDay);
}

export async function runAutoBlock(db: any, s: MarketingSettings): Promise<{ blocked: string[]; note?: string }> {
  if (!s.autoBlock) return { blocked: [], note: "auto-block is off" };
  if (!adsApiConfigured()) return { blocked: [], note: "Google Ads isn't connected" };
  const blocked: string[] = [];
  for (const r of await autoBlockCandidates(db, s)) {
    try {
      await blockSearch(db, r.label);
      await writeAudit(db, {
        entityType: "google-ads", entityId: "6099368375", action: "marketing:auto-block", changedFields: ["negative keyword"],
        previousValue: {}, newValue: { value: r.label, matchType: "EXACT", cost30d: r.cost, clicks30d: r.clicks, rule: `≥£${s.autoBlockMinSpend}, ≥${AUTO_MIN_CLICKS} clicks, 0 conversions, not a brand search` },
        changedBy: "marketing engine (automatic)",
      });
      blocked.push(r.label);
    } catch (e: any) {
      return { blocked, note: `stopped after ${blocked.length}: ${e?.message || "Google Ads refused"}` };
    }
  }
  return { blocked };
}
