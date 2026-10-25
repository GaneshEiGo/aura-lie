/**
 * PRD Section 9.6: Brute-force cosine over cached int8 vectors.
 * This is pure arithmetic, no heavy ML libraries.
 */
export class VectorMath {
  /**
   * Quantizes a Float32Array to Int8Array to save memory (768 dims = 768 bytes instead of 3072).
   * Uses a symmetric scale based on the max absolute value.
   */
  public static quantize(vec: number[]): { int8: Int8Array, scale: number } {
    let maxAbs = 0;
    for (let i = 0; i < vec.length; i++) {
      const abs = Math.abs(vec[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    
    // Prevent division by zero
    const scale = maxAbs === 0 ? 1 : maxAbs / 127;
    const int8 = new Int8Array(vec.length);
    
    for (let i = 0; i < vec.length; i++) {
      int8[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
    }
    
    return { int8, scale };
  }

  /**
   * Computes cosine similarity between two quantized vectors.
   */
  public static cosineSimilarity(a: Int8Array, b: Int8Array): number {
    if (a.length !== b.length) throw new Error('Vector dimensions must match');
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}