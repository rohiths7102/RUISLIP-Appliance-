export interface Doc { sourceType: string; sourceId: string; title: string; content: string; metadata: Record<string, any>; embedding?: number[] | null; }
export interface Hit { doc: Doc; score: number; }
const tok = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** BM25 over (title x3 + content), with an exact product-code boost. Keyless, deterministic. */
export function retrieve(query: string, docs: Doc[], k = 6): Hit[] {
  const q = tok(query); if (!q.length || !docs.length) return [];
  const docToks = docs.map((d) => tok(`${d.title} ${d.title} ${d.title} ${d.content}`));
  const N = docs.length;
  const k1 = 1.5, b = 0.75;
  const avg = docToks.reduce((a, ts) => a + ts.length, 0) / Math.max(1, N);
  // prefix match acts as a cheap stemmer: deliver~delivery, wash~washing, install~installation
  const match = (term: string, t: string) => (term.length >= 4 && t.length >= 4) ? (t === term || t.startsWith(term) || term.startsWith(t)) : t === term;
  const tfMaps = docToks.map((ts) => { const m = new Map<string, number>(); ts.forEach((t) => m.set(t, (m.get(t) || 0) + 1)); return m; });
  const ql = query.toLowerCase();
  const hits: Hit[] = docs.map((d, i) => {
    const tf = tfMaps[i]; const len = docToks[i].length;
    let score = 0;
    for (const term of q) {
      let f = 0; for (const [t, c] of tf) if (match(term, t)) f += c;
      if (!f) continue;
      let dfCount = 0; for (let j = 0; j < N; j++) { for (const t of tfMaps[j].keys()) { if (match(term, t)) { dfCount++; break; } } }
      const idf = Math.log(1 + (N - dfCount + 0.5) / (dfCount + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avg)));
    }
    const code = String(d.metadata?.productCode || "").toLowerCase();
    if (code && ql.includes(code)) score += 12;
    return { doc: d, score };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

export const cosine = (a: number[], b: number[]): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};
export function retrieveSemantic(queryVec: number[], docs: Doc[], k = 6): Hit[] {
  return docs.filter((d) => d.embedding && d.embedding.length)
    .map((d) => ({ doc: d, score: cosine(queryVec, d.embedding as number[]) }))
    .sort((a, b) => b.score - a.score).slice(0, k);
}
