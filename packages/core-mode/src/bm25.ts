import type { MemoryDoc } from './types.js';

const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 0);
}

export class BM25 {
  private docs: MemoryDoc[] = [];
  private avgDocLength: number = 0;
  private docFreqs: Map<string, number> = new Map();

  public addDocuments(texts: { id: string, text: string, importance: number }[]): void {
    for (const t of texts) {
      const tokens = tokenize(t.text);
      this.docs.push({ ...t, tokens });
    }
    this.recalculateStats();
  }

  private recalculateStats(): void {
    let totalLength = 0;
    this.docFreqs.clear();

    for (const doc of this.docs) {
      totalLength += doc.tokens.length;
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }
    this.avgDocLength = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  public search(query: string, topK: number = 3): MemoryDoc[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];

    const N = this.docs.length;
    const scores: { doc: MemoryDoc, score: number }[] = [];

    for (const doc of this.docs) {
      let score = 0;
      for (const qToken of queryTokens) {
        const df = this.docFreqs.get(qToken) || 0;
        if (df === 0) continue;

        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tf = doc.tokens.filter(t => t === qToken).length;
        const docLength = doc.tokens.length;
        
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (docLength / this.avgDocLength));
        
        score += idf * (numerator / denominator);
      }
      
      // Apply importance multiplier
      score = score * (1 + doc.importance * 0.1);

      if (score > 0) {
        scores.push({ doc, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.doc);
  }
}