/**
 * Instant email alert to the shop when an enquiry lands, via the Resend HTTP
 * API (plain fetch — no SDK dependency). Entirely env-gated: with no key or
 * recipient configured it's a silent no-op, so dev and demo installs never
 * notice it. Deliberately never throws — an alert failure must not cost the
 * lead the enquiry route just stored.
 */
export async function notifyEnquiry(record: {
  name: string;
  email: string;
  phone: string;
  message: string;
  productCode: string;
  productTitle: string;
  source: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ENQUIRY_NOTIFY_TO;
  if (!key || !to) return { sent: false, reason: "not-configured" };

  const product = record.productCode ? `${record.productTitle} (${record.productCode})` : "General enquiry";
  const body = [
    `Name:    ${record.name}`,
    `Phone:   ${record.phone || "not given"}`,
    `Email:   ${record.email || "not given"}`,
    `Product: ${product}`,
    `Source:  ${record.source}`,
    "",
    "Message:",
    record.message,
    "",
    "Please reply the same working day — a quick call back wins the sale.",
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ENQUIRY_FROM_EMAIL || "Euronics Ruislip <onboarding@resend.dev>",
        to,
        subject: `New enquiry${record.productCode ? ` — ${record.productCode}` : ""} from ${record.name}`,
        text: body,
      }),
      signal: AbortSignal.timeout(5000), // don't let a slow mail API hold up the response
    });
    if (!res.ok) return { sent: false, reason: `resend ${res.status}` };
    return { sent: true };
  } catch (err) {
    // Timeout, DNS, network — log and move on; the enquiry itself is already saved.
    console.error("notify: enquiry alert failed", err);
    return { sent: false, reason: "request-failed" };
  }
}
