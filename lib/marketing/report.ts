import { kpis, actions } from "@/lib/marketing/engine";
import { graphConfigured, sendViaOutlook } from "@/lib/mailer";
import { SITE } from "@/lib/seo";
import { adminHref } from "@/lib/admin-config";

/**
 * The Monday report: this week against last, what the engine changed, and the
 * top things to do. Plain text so it reads the same in any mail app. Built from
 * the same functions as Admin → Today, so the two never disagree.
 */
const money = (n: number) => `£${n.toFixed(2)}`;

export async function buildWeeklyReport(db: any): Promise<{ subject: string; text: string }> {
  const [k, a, changes] = await Promise.all([
    kpis(db),
    actions(db),
    db.adminAuditLog.findMany({
      where: { entityType: "google-ads", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { createdAt: "asc" }, select: { action: true, newValue: true, changedBy: true },
    }).catch(() => []),
  ]);
  const line = (x: (typeof k.items)[number]) => {
    const fmt = (n: number) => (!Number.isFinite(n) ? "no calls" : x.money ? money(n) : String(Math.round(n)));
    const diff = x.now - x.before;
    const arrow = !Number.isFinite(diff) ? `last week: ${fmt(x.before)}` : Math.abs(diff) < 0.005 ? "no change" : `${diff > 0 ? "up" : "down"} from ${fmt(x.before)}`;
    return `  ${x.label.padEnd(28)} ${fmt(x.now).padStart(9)}   (${arrow})`;
  };
  const cost = k.items.find((i) => i.label === "Cost per call");
  const base = SITE().replace(/\/+$/, "");
  const text = [
    `Jyotsna Electrical — the week of ${k.from} to ${k.to}`,
    "",
    "THIS WEEK (last week in brackets)",
    ...k.items.map(line),
    "",
    `CHANGES TO GOOGLE ADS THIS WEEK (${changes.length})`,
    ...(changes.length
      ? changes.map((c: any) => `  - ${c.action.replace(/^(ads|marketing):/, "").replace(/_/g, " ")}: ${c.newValue?.value ?? ""}  (${c.changedBy})`)
      : ["  none"]),
    "",
    `TOP THINGS TO DO (${a.list.length} in total)`,
    ...(a.list.length ? a.list.slice(0, 5).map((x, i) => `  ${i + 1}. [${x.area}] ${x.title}\n     ${x.why}`) : ["  nothing — all clear"]),
    "",
    `Open the list: ${base}${adminHref("today")}`,
  ].join("\n");
  const subject = `Weekly: ${Math.round(k.items[1].now)} calls from ads${cost && Number.isFinite(cost.now) ? ` at ${money(cost.now)} each` : ""} — ${a.list.length} things to do`;
  return { subject, text };
}

/** Outlook when Microsoft 365 is connected, otherwise Resend; never throws. */
export async function sendReport(to: string, r: { subject: string; text: string }): Promise<{ sent: boolean; via?: string; reason?: string }> {
  if (graphConfigured()) {
    const res = await sendViaOutlook({ to, subject: r.subject, body: r.text });
    return res.ok ? { sent: true, via: "Outlook" } : { sent: false, reason: res.reason };
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "No email service is set up (Microsoft 365 or RESEND_API_KEY)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.ENQUIRY_FROM_EMAIL || "Euronics Ruislip <onboarding@resend.dev>", to, subject: r.subject, text: r.text }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { sent: true, via: "Resend" } : { sent: false, reason: `Resend answered ${res.status}` };
  } catch {
    return { sent: false, reason: "The email service didn't answer." };
  }
}
