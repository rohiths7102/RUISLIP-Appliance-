export interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }
export const groqConfigured = () => !!process.env.GROQ_API_KEY;

export async function callGroq(messages: ChatMsg[], opts: { model?: string; timeoutMs?: number; temperature?: number } = {}): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const model = opts.model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.3, max_tokens: 700, stream: false }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const j: any = await r.json();
    return (j?.choices?.[0]?.message?.content || "").trim();
  } finally { clearTimeout(timer); }
}
