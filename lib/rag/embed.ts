export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null; // keyless: lexical retrieval is used instead
  const url = process.env.EMBEDDINGS_URL || "https://api.openai.com/v1/embeddings";
  const model = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: text.slice(0, 8000) }) });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}
export const embeddingsEnabled = () => !!(process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY);
