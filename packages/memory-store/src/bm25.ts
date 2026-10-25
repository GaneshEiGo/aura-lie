// packages/memory-store/src/bm25.ts
// PRD 9.6 step 1: MiniSearch-style BM25, in the tab. No model. Pure arithmetic.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with',
  'about', 'as', 'into', 'through', 'from', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'should', 'now', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface DocState {
  tf: Map<string, number>;
  dl: number;
}

const K1 = 1.2;
const B = 0.75;

export class BM25Index {
  private readonly docs = new Map<string, DocState>();
  private readonly df = new Map<string, number>();
  private totalDocs = 0;
  private avgdl = 0;

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      // Index an empty doc so a delete-by-id path exists later.
      if (!this.docs.has(id)) {
        this.docs.set(id, { tf: new Map(), dl: 0 });
        this.totalDocs += 1;
        this.recomputeAvgdl();
      }
      return;
    }
    if (this.docs.has(id)) this.remove(id);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(id, { tf, dl: tokens.length });
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.totalDocs += 1;
    this.recomputeAvgdl();
  }

  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const t of doc.tf.keys()) {
      const next = (this.df.get(t) ?? 0) - 1;
      if (next <= 0) this.df.delete(t);
      else this.df.set(t, next);
    }
    this.docs.delete(id);
    this.totalDocs -= 1;
    this.recomputeAvgdl();
  }

  search(
    query: string,
    options: { k1?: number; b?: number; limit?: number } = {},
  ): Array<{ id: string; score: number }> {
    const terms = tokenize(query);
    if (terms.length === 0 || this.totalDocs === 0) return [];

    const k1 = options.k1 ?? K1;
    const b = options.b ?? B;
    const scores = new Map<string, number>();
    const N = this.totalDocs;

    for (const term of terms) {
      const df = this.df.get(term) ?? 0;
      if (df === 0) continue;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      for (const [id, doc] of this.docs) {
        const tf = doc.tf.get(term) ?? 0;
        if (tf === 0) continue;
        const denom = tf + k1 * (1 - b + b * (doc.dl / (this.avgdl || 1)));
        const termScore = (idf * (tf * (k1 + 1))) / denom;
        scores.set(id, (scores.get(id) ?? 0) + termScore);
      }
    }

    const ranked = Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);

    return options.limit ? ranked.slice(0, options.limit) : ranked;
  }

  size(): number {
    return this.totalDocs;
  }

  clear(): void {
    this.docs.clear();
    this.df.clear();
    this.totalDocs = 0;
    this.avgdl = 0;
  }

  private recomputeAvgdl(): void {
    if (this.totalDocs === 0) {
      this.avgdl = 0;
      return;
    }
    let sum = 0;
    for (const d of this.docs.values()) sum += d.dl;
    this.avgdl = sum / this.totalDocs;
  }
}