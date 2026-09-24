/**
 * Where a visitor, call or enquiry came from — one definition, used by the
 * Telemetry page (server) and Sales & Leads (client). Pure: no imports.
 */
export const CHANNELS = ["Google Ads", "Google search (free)", "AI assistants", "Social", "Other sites", "Direct"] as const;
export type Channel = (typeof CHANNELS)[number];

const AI_HOSTS = ["chatgpt.com", "chat.openai.com", "perplexity.ai", "gemini.google.com", "copilot.microsoft.com", "claude.ai", "you.com", "phind.com", "meta.ai"];

/** `source` is the tag the site stamped (gclid → "google-ads", else the referring host); `referrer` the landing referrer host. */
export function channelOf(source: string, referrer = ""): Channel {
  if (source === "google-ads") return "Google Ads";
  const h = (referrer || source || "").toLowerCase();
  if (!h) return "Direct";
  if (AI_HOSTS.some((a) => h === a || h.endsWith(`.${a}`))) return "AI assistants";
  if (/(^|\.)google\.|(^|\.)bing\.com$|duckduckgo|(^|\.)yahoo\.|ecosia/.test(h)) return "Google search (free)";
  if (/facebook|instagram|whatsapp|(^|\.)t\.co$|twitter|(^|\.)x\.com$|linkedin|tiktok|youtube/.test(h)) return "Social";
  return "Other sites";
}
