import { telemetry } from "@/lib/marketing/telemetry";
import { health } from "@/lib/marketing/health";
import { callGroq } from "@/lib/chat/groq";
import { writeAudit } from "@/lib/audit";

/**
 * The dashboard's plain-English "this week": the last 7 days against the 7
 * before, the warnings from health(), and the product funnel, handed to the AI
 * with one rule — use only these numbers. Written once a day by the daily cron
 * and kept as a "telemetry:summary" audit row, which the dashboard shows.
 */
export async function writeWeekSummary(db: any): Promise<string> {
  const [w, two, checks] = await Promise.all([telemetry(db, 7), telemetry(db, 14), health(db)]);
  // A crawler can turn ~50 visits a day into thousands (30 Sept–6 Oct 2026). A
  // day over ten times the fortnight's quietest-quarter level is a spike, and
  // with one in the window a week-on-week visit comparison means nothing.
  const daily = two.series.map((d) => d.visits);
  const quiet = [...daily].sort((a, b) => a - b)[Math.floor(daily.length / 4)] || 0;
  const spikes = daily.filter((v) => v > Math.max(quiet * 10, 50)).length;
  const visits = spikes
    ? { thisWeek: daily.slice(7).reduce((t, v) => t + v, 0), note: `not comparable with the week before: ${spikes} day(s) of bot traffic in the last 14 days` }
    : { thisWeek: daily.slice(7).reduce((t, v) => t + v, 0), weekBefore: daily.slice(0, 7).reduce((t, v) => t + v, 0) };
  const prev = { calls: two.total.calls - w.total.calls, enquiries: two.total.enquiries - w.total.enquiries, sales: two.total.sales - w.total.sales };
  const facts = {
    visits,
    thisWeek: { productViews: w.total.productViews, callTaps: w.total.calls, postcodeChecks: w.total.postcodes, enquiries: w.total.enquiries, sales: w.total.sales },
    weekBefore: prev,
    googleAds: { clicks: w.ads.clicks, spend: Math.round(w.ads.cost), conversions: w.ads.conversions },
    topBrands: w.funnel.brands.slice(0, 6), bestSellersVsRest: w.funnel.split,
    viewedNeverCalled: w.funnel.neverCalled.slice(0, 5).map((p) => `${p.code} (${p.views} views)`),
    warnings: checks.filter((c) => c.status === "warn").map((c) => `${c.name}: ${c.detail}`),
  };
  const text = (await callGroq([
    { role: "system", content: "You write a short weekly briefing for the owner of a local appliance shop (Euronics Ruislip). Plain English, no markdown, no lists, 4 to 6 short sentences. Say what went up or down against the week before, mention anything in warnings, and the one or two most useful things to do this week. Use ONLY the numbers given; never invent figures. Never guess a cause that the numbers don't show: a warning such as a service not being connected is a thing to fix, not the reason traffic moved. If there is too little data to judge, say so." },
    { role: "user", content: JSON.stringify(facts) },
  ], { maxTokens: 500 })).replace(/\s+/g, " ").trim();
  if (!text) throw new Error("the AI returned nothing");
  await writeAudit(db, { entityType: "marketing", entityId: "week-summary", action: "telemetry:summary", changedFields: [],
    previousValue: {}, newValue: { text, facts }, changedBy: "marketing engine (weekly summary)" });
  return text;
}
