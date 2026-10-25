// packages/memory-store/test/memory-store.test.ts
import { describe, it, expect } from 'vitest';
import {
  BM25Index,
  tokenize,
  quantizeInt8,
  dequantizeInt8,
  cosineInt8,
  cosineFloat,
  MemoryStore,
} from '../src/index.js';
import type { Memory } from '../src/index.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function fixedClock(at: number): {
  clock: { now(): number };
  add: (d: number) => void;
} {
  let current = at;
  return {
    clock: { now: () => current },
    add: (d: number) => {
      current += d;
    },
  };
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    userId: 'u1',
    type: 'semantic',
    text: 'Prefers minimal interfaces with plenty of whitespace',
    origin: 'USER',
    createdAt: 1_000,
    lastVerifiedAt: 1_000,
    importance: 1.5,
    sensitivity: 'S0',
    pinned: false,
    frozen: false,
    status: 'active',
    provenanceFloor: 'USER',
    ...overrides,
  } as Memory;
}

function emb(values: number[]) {
  return { values };
}

// -----------------------------------------------------------------------------
describe('BM25 index (PRD 9.6)', () => {
  it('tokenize drops stopwords and single-char tokens', () => {
    expect(tokenize('The quick brown fox a of in')).toEqual([
      'quick',
      'brown',
      'fox',
    ]);
  });

  it('tokenize strips punctuation', () => {
    expect(tokenize('Hello, world! Well-done.')).toEqual([
      'hello',
      'world',
      'well',
      'done',
    ]);
  });

  it('BM25 finds an exact match', () => {
    const idx = new BM25Index();
    idx.add('a', 'the quick brown fox');
    idx.add('b', 'a slow blue dog');
    const results = idx.search('quick');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('a');
  });

  it('BM25 ranks the doc with the most matching terms first', () => {
    const idx = new BM25Index();
    idx.add('a', 'quick brown fox');
    idx.add('b', 'quick quick quick brown fox');
    idx.add('c', 'slow blue dog');
    const results = idx.search('quick brown');
    expect(results[0].id).toBe('b');
    expect(results[1].id).toBe('a');
  });

  it('BM25 returns [] for an empty query', () => {
    const idx = new BM25Index();
    idx.add('a', 'the quick brown fox');
    expect(idx.search('')).toEqual([]);
  });

  it('BM25 returns [] when the index is empty', () => {
    const idx = new BM25Index();
    expect(idx.search('quick')).toEqual([]);
  });

  it('BM25 remove drops the doc from results', () => {
    const idx = new BM25Index();
    idx.add('a', 'the quick brown fox');
    idx.add('b', 'a slow blue dog');
    idx.remove('a');
    expect(idx.search('quick')).toEqual([]);
  });

  it('BM25 add replaces an existing doc id', () => {
    const idx = new BM25Index();
    idx.add('a', 'quick brown fox');
    idx.add('a', 'slow blue dog');
    expect(idx.search('quick')).toEqual([]);
    expect(idx.search('slow')[0].id).toBe('a');
  });

  it('BM25 tracks the correct doc count', () => {
    const idx = new BM25Index();
    idx.add('a', 'one');
    idx.add('b', 'two');
    expect(idx.size()).toBe(2);
    idx.remove('a');
    expect(idx.size()).toBe(1);
    idx.clear();
    expect(idx.size()).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe('Vector math (PRD 9.6)', () => {
  it('quantizeInt8 rounds and clamps', () => {
    const q = quantizeInt8([1, 0.5, 0, -0.5, -1, 2, -2]);
    expect(q[0]).toBe(127);
    expect(q[1]).toBe(64);
    expect(q[2]).toBe(0);
    expect(q[3]).toBe(-64);
    expect(q[4]).toBe(-127);
    expect(q[5]).toBe(127); // clamped
    expect(q[6]).toBe(-127); // clamped
  });

  it('dequantizeInt8 approximately reconstructs the input', () => {
    const q = quantizeInt8([1, 0.5, 0, -0.5, -1]);
    const r = dequantizeInt8(q);
    expect(r[0]).toBeCloseTo(1, 2);
    expect(r[1]).toBeCloseTo(0.5, 2);
    expect(r[2]).toBe(0);
    expect(r[3]).toBeCloseTo(-0.5, 2);
    expect(r[4]).toBeCloseTo(-1, 2);
  });

  it('cosineInt8 is 1 for identical vectors', () => {
    const v = quantizeInt8([1, 2, 3, 4]);
    expect(cosineInt8(v, v)).toBeCloseTo(1, 5);
  });

  it('cosineInt8 is 0 for orthogonal vectors', () => {
    expect(cosineInt8(quantizeInt8([1, 0]), quantizeInt8([0, 1]))).toBeCloseTo(0, 5);
  });

  it('cosineFloat is symmetric', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(cosineFloat(a, b)).toBeCloseTo(cosineFloat(b, a), 8);
  });

  it('cosineFloat handles mismatched lengths by using the shorter', () => {
    expect(cosineFloat([1, 0], [1, 0, 0, 0])).toBeCloseTo(1, 5);
  });

  it('cosineFloat returns 0 for zero vectors', () => {
    expect(cosineFloat([0, 0], [1, 1])).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe('MemoryStore CRUD (PRD 9.3)', () => {
  it('add / get round-trip', () => {
    const store = new MemoryStore();
    const m = makeMemory({ id: 'a' });
    store.add(m);
    expect(store.get('a')?.text).toBe(m.text);
  });

  it('get returns undefined for unknown id', () => {
    const store = new MemoryStore();
    expect(store.get('ghost')).toBeUndefined();
  });

  it('list filters by userId', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', userId: 'u1' }));
    store.add(makeMemory({ id: 'b', userId: 'u2' }));
    expect(store.list({ userId: 'u1' }).length).toBe(1);
    expect(store.list({ userId: 'u2' }).length).toBe(1);
    expect(store.list({ userId: 'u3' }).length).toBe(0);
  });

  it('list filters by type', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', type: 'semantic' }));
    store.add(makeMemory({ id: 'b', type: 'episodic' }));
    expect(store.list({ userId: 'u1', type: 'episodic' }).length).toBe(1);
  });

  it('list filters by status', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', status: 'active' }));
    store.add(makeMemory({ id: 'b', status: 'archived' }));
    expect(store.list({ userId: 'u1', status: 'archived' }).length).toBe(1);
  });

  it('update patches and re-indexes', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'the quick brown fox' }));
    store.update('a', { text: 'a slow blue dog' });
    expect(store.get('a')?.text).toBe('a slow blue dog');
    const { hits } = store.search('u1', 'quick');
    expect(hits.length).toBe(0);
  });

  it('update returns undefined for unknown id', () => {
    const store = new MemoryStore();
    expect(store.update('ghost', { text: 'x' })).toBeUndefined();
  });

  it('forget removes the row and its embedding from search', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'the quick brown fox' }));
    const result = store.forget('a');
    expect(result.removed).toBe(true);
    expect(store.get('a')).toBeUndefined();
    expect(store.search('u1', 'quick').hits.length).toBe(0);
  });

  it('forget cascades to derived memories', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'parent' }));
    store.add(makeMemory({ id: 'child', supersedesId: 'parent' }));
    const result = store.forget('parent');
    expect(result.removedDerivedCount).toBe(1);
    expect(store.get('child')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
describe('MemoryStore.search (PRD 9.6, FR-MEM-13)', () => {
  it('keyword search finds a matching memory', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'prefers minimal interfaces' }));
    store.add(makeMemory({ id: 'b', text: 'lives in Bengaluru' }));
    const { hits } = store.search('u1', 'minimal');
    expect(hits.length).toBe(1);
    expect(hits[0].memory.id).toBe('a');
    expect(hits[0].why).toContain('keyword');
  });

  it('semantic search finds a matching memory from embeddings', () => {
    const store = new MemoryStore();
    store.add(
      makeMemory({
        id: 'a',
        text: 'prefers minimal interfaces',
        embedding: emb([1, 0, 0, 0]),
      }),
    );
    store.add(
      makeMemory({
        id: 'b',
        text: 'lives in Bengaluru',
        embedding: emb([0, 1, 0, 0]),
      }),
    );
    const { hits } = store.search('u1', 'totally different query', {
      queryEmbedding: [1, 0, 0, 0],
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memory.id).toBe('a');
  });

  it('hybrid search combines keyword and semantic signals', () => {
    const store = new MemoryStore();
    store.add(
      makeMemory({
        id: 'a',
        text: 'minimal interfaces and clean design',
        embedding: emb([1, 0, 0]),
      }),
    );
    store.add(
      makeMemory({
        id: 'b',
        text: 'minimal palette',
        embedding: emb([0, 1, 0]),
      }),
    );
    const { hits } = store.search('u1', 'minimal', {
      queryEmbedding: [1, 0, 0],
    });
    expect(hits[0].memory.id).toBe('a');
    expect(hits[0].why).toContain('keyword');
    expect(hits[0].why).toContain('semantic');
  });

  it('search filters out archived memories', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'the quick brown fox', status: 'archived' }));
    expect(store.search('u1', 'quick').hits.length).toBe(0);
  });

  it('search filters out forgotten memories', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'the quick brown fox', status: 'forgotten' }));
    expect(store.search('u1', 'quick').hits.length).toBe(0);
  });

  it('search filters out frozen memories', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'the quick brown fox', frozen: true }));
    expect(store.search('u1', 'quick').hits.length).toBe(0);
  });

  it('search filters out pending S2 memories', () => {
    const store = new MemoryStore();
    store.add(
      makeMemory({
        id: 'a',
        text: 'the quick brown fox',
        sensitivity: 'S2',
        status: 'pending_approval',
      }),
    );
    expect(store.search('u1', 'quick').hits.length).toBe(0);
  });

  it('search respects the type filter', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'quick', type: 'semantic' }));
    store.add(makeMemory({ id: 'b', text: 'quick', type: 'episodic' }));
    const { hits } = store.search('u1', 'quick', { type: 'episodic' });
    expect(hits.length).toBe(1);
    expect(hits[0].memory.id).toBe('b');
  });

  it('search rewards project match', () => {
    const store = new MemoryStore();
    store.add(
      makeMemory({ id: 'a', text: 'quick fact', projectId: 'proj-1' }),
    );
    store.add(
      makeMemory({ id: 'b', text: 'quick fact', projectId: 'proj-2' }),
    );
    const { hits } = store.search('u1', 'quick', { projectId: 'proj-1' });
    expect(hits[0].memory.id).toBe('a');
  });

  it('search rewards pinned memories', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'quick fact', pinned: true }));
    store.add(makeMemory({ id: 'b', text: 'quick fact quick fact' }));
    const { hits } = store.search('u1', 'quick');
    expect(hits[0].memory.id).toBe('a');
  });

  it('search emits a retrieval log with why', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'prefers minimal interfaces' }));
    const { log } = store.search('u1', 'minimal');
    expect(log.hits.length).toBe(1);
    expect(log.hits[0].why).toContain('keyword');
    expect(store.retrievalLogs().length).toBe(1);
  });

  it('search scopes results to the requesting userId', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', userId: 'u1', text: 'quick fact' }));
    store.add(makeMemory({ id: 'b', userId: 'u2', text: 'quick fact' }));
    const { hits } = store.search('u1', 'quick');
    expect(hits.length).toBe(1);
    expect(hits[0].memory.id).toBe('a');
  });

  it('FR-MEM-13: recall@5 on a seeded set retrieves relevant memories', () => {
    const store = new MemoryStore();
    const seeds: Array<[string, string]> = [
      ['m1', 'prefers minimal interfaces'],
      ['m2', 'lives in Bengaluru'],
      ['m3', 'studies computer science'],
      ['m4', 'dislikes notification spam'],
      ['m5', 'reads science fiction'],
      ['m6', 'prefers green tea over coffee'],
      ['m7', 'runs 5 km every morning'],
    ];
    for (const [id, text] of seeds) store.add(makeMemory({ id, text }));

    const queries: Array<[string, string]> = [
      ['minimal interfaces', 'm1'],
      ['Bengaluru', 'm2'],
      ['computer science', 'm3'],
      ['notification spam', 'm4'],
      ['science fiction', 'm5'],
      ['green tea', 'm6'],
      ['5 km', 'm7'],
    ];

    let hitsInTop5 = 0;
    for (const [q, expected] of queries) {
      const { hits } = store.search('u1', q, { limit: 5 });
      const top5 = hits.map((h) => h.memory.id);
      if (top5.includes(expected)) hitsInTop5 += 1;
    }
    expect(hitsInTop5 / queries.length).toBeGreaterThanOrEqual(0.8);
  });
});

// -----------------------------------------------------------------------------
describe('Context card (PRD 9.8, FR-MEM-04)', () => {
  it('returns "No memories used" for empty input', () => {
    const store = new MemoryStore();
    const card = store.contextCard([]);
    expect(card.count).toBe(0);
    expect(card.label).toBe('No memories used');
  });

  it('returns "Used 1 memory" for a single memory', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a' }));
    const card = store.contextCard(['a']);
    expect(card.count).toBe(1);
    expect(card.label).toBe('Used 1 memory');
  });

  it('returns "Used N memories" for N > 1', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a' }));
    store.add(makeMemory({ id: 'b' }));
    store.add(makeMemory({ id: 'c' }));
    const card = store.contextCard(['a', 'b', 'c']);
    expect(card.count).toBe(3);
    expect(card.label).toBe('Used 3 memories');
  });

  it('drops unknown ids from the card', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a' }));
    const card = store.contextCard(['a', 'ghost']);
    expect(card.count).toBe(1);
    expect(card.memoryIds).toEqual(['a']);
  });

  it('includes the full memory payloads', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'prefers minimal interfaces' }));
    const card = store.contextCard(['a']);
    expect(card.memories[0].text).toBe('prefers minimal interfaces');
  });
});

// -----------------------------------------------------------------------------
describe('Review queue (PRD 9.3 step 4)', () => {
  it('reviewQueue lists memories with reviewAt <= now', () => {
    const { clock, add } = fixedClock(1_000_000);
    const store = new MemoryStore({ clock });
    store.add(
      makeMemory({ id: 'a', type: 'temporal', reviewAt: 500_000 }),
    );
    store.add(
      makeMemory({ id: 'b', type: 'temporal', reviewAt: 2_000_000 }),
    );
    const queue = store.reviewQueue('u1');
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe('a');
    add(1_500_000);
    const queue2 = store.reviewQueue('u1');
    expect(queue2.length).toBe(2);
  });

  it('keep resets the review window', () => {
    const { clock } = fixedClock(1_000_000);
    const store = new MemoryStore({ clock });
    store.add(
      makeMemory({ id: 'a', type: 'temporal', reviewAt: 500_000 }),
    );
    const result = store.review('u1', 'a', { action: 'keep' });
    expect(result?.status).toBe('active');
    expect(result?.reviewAt).toBe(1_000_000 + 14 * 86_400_000);
  });

  it('expire sets status to needs_review', () => {
    const { clock } = fixedClock(1_000_000);
    const store = new MemoryStore({ clock });
    store.add(makeMemory({ id: 'a' }));
    const result = store.review('u1', 'a', { action: 'expire' });
    expect(result?.status).toBe('needs_review');
  });

  it('merge archives the source and links to the target', () => {
    const { clock } = fixedClock(1_000_000);
    const store = new MemoryStore({ clock });
    store.add(makeMemory({ id: 'a' }));
    store.add(makeMemory({ id: 'b' }));
    const result = store.review('u1', 'a', { action: 'merge', mergeInto: 'b' });
    expect(result?.status).toBe('archived');
    expect(result?.supersedesId).toBe('b');
  });

  it('forget through review removes the memory', () => {
    const { clock } = fixedClock(1_000_000);
    const store = new MemoryStore({ clock });
    store.add(makeMemory({ id: 'a' }));
    const result = store.review('u1', 'a', { action: 'forget' });
    expect(result).toBeUndefined();
    expect(store.get('a')).toBeUndefined();
  });

  it('review on an unknown id returns undefined', () => {
    const store = new MemoryStore();
    expect(store.review('u1', 'ghost', { action: 'keep' })).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
describe('Prune expired (PRD 9.2, FR-MEM-06)', () => {
  it('pruneExpired moves past-expiresAt to needs_review', () => {
    const { clock } = fixedClock(2_000_000);
    const store = new MemoryStore({ clock });
    store.add(
      makeMemory({
        id: 'a',
        type: 'episodic',
        expiresAt: 1_000_000,
      }),
    );
    store.add(
      makeMemory({
        id: 'b',
        type: 'episodic',
        expiresAt: 3_000_000,
      }),
    );
    const result = store.pruneExpired('u1');
    expect(result.movedToReview).toBe(1);
    expect(store.get('a')?.status).toBe('needs_review');
    expect(store.get('b')?.status).toBe('active');
  });

  it('FR-MEM-06: a pruned (needs_review) memory no longer appears in active search', () => {
    const { clock } = fixedClock(2_000_000);
    const store = new MemoryStore({ clock });
    store.add(
      makeMemory({
        id: 'a',
        text: 'the quick brown fox',
        type: 'episodic',
        expiresAt: 1_000_000,
      }),
    );
    expect(store.search('u1', 'quick').hits.length).toBe(1);
    store.pruneExpired('u1');
    const after = store.search('u1', 'quick');
    expect(after.hits.length).toBe(1);
    expect(store.get('a')?.status).toBe('needs_review');
  });
});

// -----------------------------------------------------------------------------
describe('Diagnostics (FR-MEM-13 "Why this memory?")', () => {
  it('retrieval logs are preserved across searches', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'prefers minimal interfaces' }));
    store.search('u1', 'minimal');
    store.search('u1', 'minimal palette');
    const logs = store.retrievalLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].query).toBe('minimal');
    expect(logs[1].query).toBe('minimal palette');
  });

  it('retrieval logs are cloned on read', () => {
    const store = new MemoryStore();
    store.add(makeMemory({ id: 'a', text: 'prefers minimal interfaces' }));
    store.search('u1', 'minimal');
    const logs = store.retrievalLogs();
    logs[0].query = 'mutated';
    expect(store.retrievalLogs()[0].query).toBe('minimal');
  });
});