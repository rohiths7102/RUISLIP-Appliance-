import { agentReport } from "@/lib/price-watch/agent-report";
import { sendWhatsApp } from "@/lib/whatsapp";
import { writeAudit } from "@/lib/audit";

/**
 * The owner's morning price message (Sept 2026: "send it to Sachin's number
 * … and on the website both"). One line built from the agent report — what
 * changed in the last 24 hours and what each price source last said — sent to
 * his WhatsApp and kept as a "notify:daily-summary" audit row, which Admin →
 * Price watch lists, so a missed or failed message is still on the website.
 */
export async function sendDailySummary(db: any): Promise<{ text: string; whatsapp: string }> {
  const r = await agentReport(db, { windowDays: 1 });
  const t = r.totals;
  // Only the sources that set prices; the competitor checks stay on the website.
  const sources = r.sources.filter((s) => s.kind === "authorised");
  const parts = [
    t.applied
      ? `${t.applied} price${t.applied === 1 ? "" : "s"} updated in the last 24 hours (${t.rises} up, ${t.drops} down).`
      : "No prices changed in the last 24 hours.",
    ...sources.filter((s) => s.enabled && s.lastRunStatus).map((s) => `${s.label}: ${s.lastRunStatus}.`),
    ...sources.filter((s) => s.health === "overdue" || s.health === "halted" || s.health === "never").map((s) => `Needs a look: ${s.label} — ${s.note}`),
    "Details: kitchen-appliances.co.uk/admin/price-watch",
  ];
  const text = parts.join(" ");
  const wa = await sendWhatsApp(text);
  const whatsapp = wa.sent ? "sent" : `not sent: ${wa.reason}`;
  await writeAudit(db, {
    entityType: "notification", entityId: "daily-summary", action: "notify:daily-summary", changedFields: [],
    previousValue: {}, newValue: { text, whatsapp }, changedBy: "price agent (daily summary)",
  });
  return { text, whatsapp };
}
