/**
 * Outbound email for the sales pipeline, built Outlook-first.
 *
 * The owner's business runs on Microsoft 365 but Entra isn't connected yet, so
 * this module carries the COMPLETE Microsoft Graph send path (client-credentials
 * -> /users/{sender}/sendMail) and simply reports "not_connected" until the four
 * env vars exist. The day the app registration is created, sending lights up
 * with zero code changes:
 *
 *   MS_TENANT_ID      Entra tenant (Directory ID)
 *   MS_CLIENT_ID      App registration (Application ID)
 *   MS_CLIENT_SECRET  Client secret value
 *   MS_SENDER_UPN     Mailbox to send as, e.g. sales@kitchen-appliances.co.uk
 *                     (app needs the application permission Mail.Send, admin-consented;
 *                      scope it to this mailbox with an ApplicationAccessPolicy)
 *
 * Until then the UI falls back to mailto: / copy — the owner still sends from
 * his own Outlook, just with one extra click.
 */

export const graphConfigured = () =>
  !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER_UPN);

type SendResult = { ok: true } | { ok: false; reason: "not_connected" | "token_failed" | "send_failed" };

/**
 * Microsoft sits on the critical path of a request the owner is watching. Without
 * a deadline a slow or blackholed endpoint leaves the button spinning on
 * "Sending…" until the platform kills the route — no result, no audit row, and no
 * way for him to know whether the lead was emailed. Both budgets together stay
 * inside a serverless invocation with room for the enquiry update that follows,
 * and a blown deadline resolves to a normal typed failure rather than a throw.
 */
const TOKEN_TIMEOUT_MS = 8000;
const SEND_TIMEOUT_MS = 12000;

async function graphToken(): Promise<string | null> {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => null)) as { access_token?: string } | null;
  return j?.access_token || null;
}

export async function sendViaOutlook(input: { to: string; toName?: string; subject: string; body: string }): Promise<SendResult> {
  if (!graphConfigured()) return { ok: false, reason: "not_connected" };
  const token = await graphToken();
  if (!token) return { ok: false, reason: "token_failed" };

  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MS_SENDER_UPN!)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      saveToSentItems: true, // the owner sees it in his own Sent folder — no shadow inbox
      message: {
        subject: input.subject,
        body: { contentType: "Text", content: input.body },
        toRecipients: [{ emailAddress: { address: input.to, name: input.toName || undefined } }],
      },
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  }).catch(() => null);
  // A timeout here is ambiguous — Graph may have accepted the message — so report
  // the failure and never retry: the owner's Sent folder is the record of truth.
  return r?.status === 202 ? { ok: true } : { ok: false, reason: "send_failed" };
}
