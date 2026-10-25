import { describe, it, expect } from 'vitest';
import { VectorMath } from '../src/math.js';
import { VectorStore } from '../src/store.js';

describe('Vector Search (PRD 9.6)', () => {
  it('should quantize a float vector to int8 and preserve direction', () => {
    const floatVec = [0.1, -0.5, 1.0, 0.0];
    const { int8, scale } = VectorMath.quantize(floatVec);
    
    expect(int8.length).toBe(4);
    expect(scale).toBeCloseTo(1.0 / 127);
    
    // 1.0 / (1/127) = 127
    expect(int8[2]).toBe(127);
  });

  it('should calculate cosine similarity correctly', () => {
    const vecA = new Int8Array([1, 0, 0]);
    const vecB = new Int8Array([1, 0, 0]);
    const vecC = new Int8Array([0, 1, 0]);
    
    expect(VectorMath.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    expect(VectorMath.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
  });

  it('should store, search, and rank vectors in the in-memory store', () => {
    const store = new VectorStore();
    
    // Mock embeddings (3 dimensions for test)
    store.add('doc1', 'Solid state batteries', [1.0, 0.0, 0.0]);
    store.add('doc2', 'Liquid batteries', [0.9, 0.1, 0.0]);
    store.add('doc3', 'Cats and dogs', [0.0, 1.0, 0.0]);

    // Query closer to doc1 and doc2
    const results = store.search([1.0, 0.05, 0.0], 2);
    
    expect(results.length).toBe(2);
    expect(results[0].document.id).toBe('doc1');
    expect(results[1].document.id).toBe('doc2');
    expect(results[0].score).toBeGreaterThan(0.9);
  });
});