/**
 * Messages to the owner's own phone over the official WhatsApp Business
 * (Cloud) API. A personal WhatsApp has no API, so the site sends from its own
 * business number (set up once in Meta's WhatsApp Manager) TO the owner's
 * ordinary number.
 *
 * WhatsApp only lets a business start a conversation with a pre-approved
 * template, so every message is the template WHATSAPP_TEMPLATE whose body has
 * one {{1}}, filled with a single line of text (WhatsApp rejects new lines in
 * a template value).
 *
 * Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO (owner's number,
 * digits with country code, e.g. 447700900123), WHATSAPP_TEMPLATE (default
 * "daily_price_summary"), WHATSAPP_TEMPLATE_LANG (default "en_GB").
 */
export const whatsappConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TO);

export async function sendWhatsApp(line: string): Promise<{ sent: boolean; reason?: string }> {
  if (!whatsappConfigured()) return { sent: false, reason: "WhatsApp isn't set up (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO)." };
  const text = line.replace(/\s+/g, " ").trim().slice(0, 1000);
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(process.env.WHATSAPP_TO).replace(/\D/g, ""),
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE || "daily_price_summary",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en_GB" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { sent: true };
    const j: any = await res.json().catch(() => null);
    return { sent: false, reason: `WhatsApp answered ${res.status}${j?.error?.message ? `: ${j.error.message}` : ""}` };
  } catch {
    return { sent: false, reason: "WhatsApp didn't answer." };
  }
}
