export interface Doc { sourceType: string; sourceId: string; title: string; content: string; metadata: Record<string, any>; embedding?: number[] | null; }
export interface Hit { doc: Doc; score: number; }
export const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Typing slips between two words: a missing, extra, wrong or swapped letter each count 1. */
export function slips(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * BM25 over an inverted index, built once and searched many times. The old
 * version re-counted each word's document frequency inside its per-document
 * loop: 7.6 seconds for "whats the price of WGG254" over 4,060 documents.
 */
export type Lex = { n: number; avg: number; len: number[]; post: Map<string, { d: number[]; f: number[] }> };

export function lexIndex(texts: string[]): Lex {
  const post: Lex["post"] = new Map();
  const len: number[] = [];
  texts.forEach((text, i) => {
    const ws = tokens(text);
    len.push(ws.length);
    const tf = new Map<string, number>();
    for (const w of ws) tf.set(w, (tf.get(w) || 0) + 1);
    for (const [w, c] of tf) {
      let p = post.get(w);
      if (!p) post.set(w, (p = { d: [], f: [] }));
      p.d.push(i); p.f.push(c);
    }
  });
  return { n: texts.length, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, texts.length), len, post };
}

/** The index words a query word stands for: itself, its stem family (a prefix
 *  either way acts as a cheap stemmer: deliver~delivery, washing~wash), or — if
 *  neither exists — a one-slip typo ("dishwaser"). A shorter stem may drop at
 *  most three letters, or "dishwaser" would stand for "dish" (a butter dish). */
function variants(ix: Lex, term: string): string[] {
  const out: string[] = [];
  for (const t of ix.post.keys()) {
    if (t === term || (term.length >= 4 && t.length >= 4 && (t.startsWith(term) || (term.startsWith(t) && t.length >= term.length - 3)))) out.push(t);
  }
  if (out.length || term.length < 5) return out;
  for (const t of ix.post.keys()) if (t.length >= 5 && Math.abs(t.length - term.length) <= 1 && slips(t, term) <= 1) out.push(t);
  return out;
}

export function lexSearch(ix: Lex, terms: string[], k: number): { i: number; score: number }[] {
  const k1 = 1.5, b = 0.75;
  const score = new Map<number, number>();
  for (const term of new Set(terms)) {
    const f = new Map<number, number>();
    for (const t of variants(ix, term)) {
      const p = ix.post.get(t)!;
      for (let j = 0; j < p.d.length; j++) f.set(p.d[j], (f.get(p.d[j]) || 0) + p.f[j]);
    }
    if (!f.size) continue;
    const idf = Math.log(1 + (ix.n - f.size + 0.5) / (f.size + 0.5));
    for (const [d, c] of f) score.set(d, (score.get(d) || 0) + (idf * c * (k1 + 1)) / (c + k1 * (1 - b + (b * ix.len[d]) / ix.avg)));
  }
  return [...score].map(([i, s]) => ({ i, score: s })).sort((x, y) => y.score - x.score).slice(0, k);
}

/** BM25 over (title x3 + content), with an exact product-code boost. Keyless, deterministic. */
export function retrieve(query: string, docs: Doc[], k = 6): Hit[] {
  if (!docs.length) return [];
  const score = new Map(lexSearch(lexIndex(docs.map((d) => `${d.title} ${d.title} ${d.title} ${d.content}`)), tokens(query), docs.length).map((h) => [h.i, h.score]));
  const ql = query.toLowerCase();
  docs.forEach((d, i) => {
    const code = String(d.metadata?.productCode || "").toLowerCase();
    if (code && ql.includes(code)) score.set(i, (score.get(i) || 0) + 12);
  });
  return [...score].sort((x, y) => y[1] - x[1]).slice(0, k).map(([i, s]) => ({ doc: docs[i], score: s }));
}
