export interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }
export const groqConfigured = () => !!process.env.GROQ_API_KEY;

/**
 * Default model. Must be one the account can actually serve: a wrong id fails
 * with 404 model_not_found on EVERY message, and the widget shows only its
 * "having trouble" fallback — indistinguishable from an outage. The previous
 * default (llama-3.3-70b-versatile) was decommissioned and silently killed the
 * assistant. Verify with `GET /openai/v1/models` after any key change.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export async function callGroq(messages: ChatMsg[], opts: { model?: string; timeoutMs?: number; temperature?: number } = {}): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const model = opts.model || process.env.GROQ_MODEL || DEFAULT_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, messages, temperature: opts.temperature ?? 0.3, max_tokens: 700, stream: false,
        // Reasoning models bill their thinking against max_tokens and return it
        // in a separate `reasoning` field we never show. Left at default, a long
        // think can consume the whole budget and return EMPTY content — a
        // "broken" chatbot with a 200 OK. "low" keeps it to ~20 tokens, which is
        // right for a shop assistant that should answer plainly and fast.
        // Ignored by non-reasoning models, so it is safe across model changes.
        reasoning_effort: "low",
      }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const j: any = await r.json();
    // `content` only — never `reasoning`, which is the model's private scratchpad
    // and must not be shown to a customer.
    return (j?.choices?.[0]?.message?.content || "").trim();
  } finally { clearTimeout(timer); }
}
