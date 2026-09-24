/**
 * The marketing engine's switches, stored on BusinessInfo.marketing. Anything
 * that changes the Google Ads account or sends email is OFF until the owner
 * turns it on in Admin → Today.
 */
export type MarketingSettings = {
  /** Nightly: block searches that clearly waste money (rules in lib/marketing/automation.ts). */
  autoBlock: boolean;
  /** A search must have cost at least this much (£, last 30 days) with no conversion. */
  autoBlockMinSpend: number;
  /** Never block more than this many in one night. */
  autoBlockMaxPerDay: number;
  /** Monday-morning report by email. */
  weeklyReport: boolean;
  reportTo: string;
  /** Monthly targets shown on the dashboard; 0 = no target. */
  targets: { adCalls: number; enquiries: number; sales: number; adSpend: number };
};

export const DEFAULTS: MarketingSettings = {
  autoBlock: false, autoBlockMinSpend: 8, autoBlockMaxPerDay: 10, weeklyReport: false, reportTo: "",
  targets: { adCalls: 0, enquiries: 0, sales: 0, adSpend: 0 },
};

const clamp = (n: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);

export function toSettings(raw: any): MarketingSettings {
  return {
    autoBlock: raw?.autoBlock === true,
    autoBlockMinSpend: clamp(raw?.autoBlockMinSpend, 3, 100, DEFAULTS.autoBlockMinSpend),
    autoBlockMaxPerDay: Math.round(clamp(raw?.autoBlockMaxPerDay, 1, 25, DEFAULTS.autoBlockMaxPerDay)),
    weeklyReport: raw?.weeklyReport === true,
    reportTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw?.reportTo ?? "").trim()) ? String(raw.reportTo).trim() : "",
    targets: {
      adCalls: Math.round(clamp(raw?.targets?.adCalls, 0, 100000, 0)),
      enquiries: Math.round(clamp(raw?.targets?.enquiries, 0, 100000, 0)),
      sales: Math.round(clamp(raw?.targets?.sales, 0, 100000, 0)),
      adSpend: Math.round(clamp(raw?.targets?.adSpend, 0, 1000000, 0)),
    },
  };
}

export async function getSettings(db: any): Promise<MarketingSettings> {
  const row = await db.businessInfo.findUnique({ where: { id: "business" }, select: { marketing: true } }).catch(() => null);
  return toSettings(row?.marketing);
}

export async function saveSettings(db: any, raw: unknown): Promise<MarketingSettings> {
  const next = toSettings(raw);
  await db.businessInfo.update({ where: { id: "business" }, data: { marketing: next } });
  return next;
}
