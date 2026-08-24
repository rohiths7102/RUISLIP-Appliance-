export interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }
export const groqConfigured = () => !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);

/**
 * Default model. Must be one the account can actually serve: a wrong id fails
 * with 404 model_not_found on EVERY message, and the widget shows only its
 * "having trouble" fallback — indistinguishable from an outage. The previous
 * default (llama-3.3-70b-versatile) was decommissioned and silently killed the
 * assistant. Verify with `GET /openai/v1/models` after any key change.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

async function callGroqOnly(messages: ChatMsg[], opts: { model?: string; timeoutMs?: number; temperature?: number } = {}): Promise<string> {
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

/** Gemini's current flash model. Older ids (gemini-1.5/2.0-flash) are retired
 *  and 404 — check `GET /v1beta/models` after any key change. */
const GEMINI_MODEL = "gemini-3.6-flash";

async function callGemini(messages: ChatMsg[], timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || GEMINI_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Gemini has no "system" role: the system prompt becomes systemInstruction
    // and only user/assistant turns go in contents, or the store rules would be
    // read as something the customer said.
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages.filter((m) => m.role !== "system");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
      }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const j: any = await r.json();
    return (j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "").trim();
  } finally { clearTimeout(timer); }
}

/**
 * Ask Groq; fall back to Gemini.
 *
 * Groq's free tier has a DAILY quota. When it runs out every message 429s and
 * the widget shows only its "having trouble" line — the assistant is dead for
 * the rest of the day and nothing says why. Two providers on different quotas
 * means one exhausted account cannot take the shop's assistant off the air.
 *
 * The fallback is deliberately unconditional rather than 429-only: a 5xx, a
 * retired model id or a timeout leaves the customer just as stuck, and Gemini
 * answering is always better than the fallback sentence.
 */
export async function callGroq(messages: ChatMsg[], opts: { model?: string; timeoutMs?: number; temperature?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  if (process.env.GROQ_API_KEY) {
    try {
      const out = await callGroqOnly(messages, opts);
      if (out) return out;
      console.warn("chat: Groq returned empty content, trying Gemini");
    } catch (e) {
      console.warn("chat: Groq failed, trying Gemini —", String((e as Error)?.message || e));
    }
  }
  return callGemini(messages, timeoutMs);
}
