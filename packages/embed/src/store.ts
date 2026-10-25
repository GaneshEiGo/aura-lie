import { VectorMath } from './math.js';

export interface VectorDocument {
  id: string;
  text: string;
  vector: Int8Array;
  scale: number;
  metadata?: Record<string, any>;
}

export interface SearchResult {
  document: VectorDocument;
  score: number;
}

export class VectorStore {
  private documents: VectorDocument[] = [];

  public add(id: string, text: string, floatVector: number[], metadata?: Record<string, any>): void {
    const { int8, scale } = VectorMath.quantize(floatVector);
    this.documents.push({ id, text, vector: int8, scale, metadata });
  }

  public search(queryFloatVector: number[], topK: number = 5): SearchResult[] {
    const { int8: queryVec } = VectorMath.quantize(queryFloatVector);
    
    const results = this.documents.map(doc => {
      const score = VectorMath.cosineSimilarity(queryVec, doc.vector);
      return { document: doc, score };
    });

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }

  public size(): number {
    return this.documents.length;
  }
}