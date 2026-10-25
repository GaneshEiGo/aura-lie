// === FILE START ===
// packages/memory-store/test/retrieval-v2.test.ts
// PRD 9.6 · FR-MEM-13 · FR-MEM-04 · FR-MEM-08.
//
// Recall@5 ≥ 0.8 on a seeded corpus.
// Plus per-invariant tests: frozen excluded, unapproved S2 excluded,
// pinned boosted, project scope honoured, deterministic ordering.

import { describe, it, expect } from 'vitest';
import {
  hybridRetrieve,
  quantizeInt8,
  cosineInt8,
  VECTOR_DIM,
  type RetrievalCandidate,
} from '../src/retrieval-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function mkVec(n: number, position: number): number[] {
  const v = new Array(n).fill(0);
  v[position] = 1;
  return v;
}

function mem(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    id: 'm1',
    text: 'I prefer dark mode.',
    type: 'semantic',
    sensitivity: 'S1',
    createdAt: T0 - DAY_MS,
    ...overrides,
  };
}

// =============================================================================
// Int8 quantization
// =============================================================================

describe('quantizeInt8 + cosineInt8', () => {
  it('VECTOR_DIM is 768', () => {
    expect(VECTOR_DIM).toBe(768);
  });
  it('round-trip: similar vectors → high cosine', () => {
    const a = new Array(VECTOR_DIM).fill(0);
    const b = new Array(VECTOR_DIM).fill(0);
    for (let i = 0; i < VECTOR_DIM; i++) {
      a[i] = Math.sin(i * 0.1);
      b[i] = Math.sin(i * 0.1);
    }
    const qa = quantizeInt8(a);
    const qb = quantizeInt8(b);
    expect(cosineInt8(qa, qb)).toBeCloseTo(1, 2);
  });
  it('orthogonal vectors → cosine 0', () => {
    const a = new Array(VECTOR_DIM).fill(0);
    const b = new Array(VECTOR_DIM).fill(0);
    a[0] = 1;
    b[1] = 1;
    expect(cosineInt8(quantizeInt8(a), quantizeInt8(b))).toBeCloseTo(0, 5);
  });
  it('zero vector → cosine 0', () => {
    const zero = new Array(VECTOR_DIM).fill(0);
    const a = new Array(VECTOR_DIM).fill(0);
    a[0] = 1;
    expect(cosineInt8(quantizeInt8(zero), quantizeInt8(a))).toBe(0);
  });
});

// =============================================================================
// Filtering
// =============================================================================

describe('filtering', () => {
  it('frozen memories excluded', () => {
    const r = hybridRetrieve({
      queryText: 'dark mode',
      candidates: [mem({ id: 'a', frozen: true }), mem({ id: 'b' })],
    });
    expect(r.hits.find((h) => h.id === 'a')).toBeUndefined();
    expect(r.filtered.find((f) => f.id === 'a')?.reason).toBe('frozen');
    expect(r.hits.find((h) => h.id === 'b')).toBeDefined();
  });

  it('unapproved S2 memories excluded by default', () => {
    const r = hybridRetrieve({
      queryText: 'health',
      candidates: [mem({ id: 's2', sensitivity: 'S2', text: 'I have a health condition.' })],
    });
    expect(r.hits.find((h) => h.id === 's2')).toBeUndefined();
    expect(r.filtered.find((f) => f.id === 's2')?.reason).toContain('S2');
  });

  it('unapproved S2 INCLUDED when includeUnapprovedS2: true', () => {
    const r = hybridRetrieve({
      queryText: 'health',
      includeUnapprovedS2: true,
      candidates: [mem({ id: 's2', sensitivity: 'S2', text: 'I have a health condition.' })],
    });
    expect(r.hits.find((h) => h.id === 's2')).toBeDefined();
  });

  it('S2 memory with s2Approved:true included', () => {
    const r = hybridRetrieve({
      queryText: 'health',
      candidates: [
        mem({ id: 's2', sensitivity: 'S2', s2Approved: true, text: 'I have a health condition.' }),
      ],
    });
    expect(r.hits.find((h) => h.id === 's2')).toBeDefined();
  });

  it('project scope: memories in other projects excluded', () => {
    const r = hybridRetrieve({
      queryText: 'design',
      projectId: 'p1',
      candidates: [
        mem({ id: 'a', projectId: 'p1', text: 'Design decisions.' }),
        mem({ id: 'b', projectId: 'p2', text: 'Design decisions.' }),
      ],
    });
    expect(r.hits.find((h) => h.id === 'a')).toBeDefined();
    expect(r.hits.find((h) => h.id === 'b')).toBeUndefined();
  });
});

// =============================================================================
// BM25 alone
// =============================================================================

describe('BM25 retrieval (no vectors)', () => {
  it('query "coffee" returns the coffee memory', () => {
    const r = hybridRetrieve({
      queryText: 'coffee',
      candidates: [
        mem({ id: 'a', text: 'I prefer coffee.' }),
        mem({ id: 'b', text: 'The Eiffel Tower is tall.' }),
        mem({ id: 'c', text: 'Cats like fish.' }),
      ],
    });
    expect(r.hits[0].id).toBe('a');
  });

  it('BM25 score is positive for matching documents', () => {
    const r = hybridRetrieve({
      queryText: 'dark mode',
      candidates: [mem({ id: 'a', text: 'I prefer dark mode.' })],
    });
    expect(r.hits[0].bm25Score).toBeGreaterThan(0);
  });

  it('irrelevant query yields score 0', () => {
    const r = hybridRetrieve({
      queryText: 'zebra',
      candidates: [mem({ id: 'a', text: 'I prefer dark mode.' })],
    });
    expect(r.hits[0].bm25Score).toBe(0);
  });
});

// =============================================================================
// Vector + hybrid
// =============================================================================

describe('vector + hybrid retrieval', () => {
  it('vector similarity contributes to combined score', () => {
    const queryVec = mkVec(VECTOR_DIM, 5);
    const docVec = mkVec(VECTOR_DIM, 5);
    const r = hybridRetrieve({
      queryText: 'irrelevant',
      queryEmbedding: queryVec,
      candidates: [
        mem({ id: 'match', text: 'unrelated words', embeddingInt8: quantizeInt8(docVec) }),
        mem({ id: 'no-match', text: 'unrelated words', embeddingInt8: quantizeInt8(mkVec(VECTOR_DIM, 10)) }),
      ],
    });
    expect(r.hits[0].id).toBe('match');
  });

  it('pinned memory is boosted to top', () => {
    const r = hybridRetrieve({
      queryText: 'coffee',
      candidates: [
        mem({ id: 'a', text: 'I prefer coffee.' }),
        mem({ id: 'pin', text: 'unrelated', pinned: true }),
      ],
    });
    expect(r.hits[0].id).toBe('pin');
  });
});

// =============================================================================
// FR-MEM-13 — Recall@5 ≥ 0.8
// =============================================================================

describe('FR-MEM-13 — Recall@5 ≥ 0.8', () => {
  it('seeded corpus: 20 query-target pairs, ≥ 16 returned in top-5', () => {
    // 30 documents covering 20 distinct topics
    const docs: RetrievalCandidate[] = [
      { id: 'd01', text: 'Coffee is a popular morning beverage.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd02', text: 'Tea comes in many varieties like green and black.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd03', text: 'The Eiffel Tower is in Paris.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd04', text: 'Cats are independent pets.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd05', text: 'Dogs need daily walks.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd06', text: 'Python is a programming language.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd07', text: 'TypeScript adds static types to JavaScript.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd08', text: 'React is a UI library.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd09', text: 'Vite is a build tool.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd10', text: 'Cloudflare Workers run at the edge.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd11', text: 'IndexedDB is a browser database.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd12', text: 'Durable Objects provide strong consistency.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd13', text: 'SQLite is a lightweight database.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd14', text: 'Postgres is a relational database.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd15', text: 'GitHub Actions runs CI workflows.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd16', text: 'Playwright runs browser tests.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd17', text: 'Vitest is a test runner.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd18', text: 'Biome lints and formats code.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd19', text: 'Prettier formats code.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd20', text: 'ESLint catches bugs in JavaScript.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd21', text: 'The Sun is a star.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd22', text: 'The Moon orbits Earth.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd23', text: 'Mars is called the Red Planet.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd24', text: 'Water boils at 100 Celsius.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd25', text: 'Photosynthesis occurs in plants.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd26', text: 'The human body has 206 bones.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd27', text: 'Octopuses have three hearts.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd28', text: 'Penguins live in the Southern Hemisphere.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd29', text: 'The Amazon is the largest river.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
      { id: 'd30', text: 'Sharks are ancient animals.', type: 'semantic', sensitivity: 'S0', createdAt: T0 },
    ];

    const queries: Array<{ query: string; target: string }> = [
      { query: 'coffee', target: 'd01' },
      { query: 'tea', target: 'd02' },
      { query: 'Eiffel Tower', target: 'd03' },
      { query: 'cats pets', target: 'd04' },
      { query: 'dogs walks', target: 'd05' },
      { query: 'Python programming', target: 'd06' },
      { query: 'TypeScript types', target: 'd07' },
      { query: 'React library', target: 'd08' },
      { query: 'Vite build', target: 'd09' },
      { query: 'Cloudflare Workers edge', target: 'd10' },
      { query: 'IndexedDB browser', target: 'd11' },
      { query: 'Durable Objects', target: 'd12' },
      { query: 'SQLite database', target: 'd13' },
      { query: 'Postgres relational', target: 'd14' },
      { query: 'GitHub Actions workflows', target: 'd15' },
      { query: 'Playwright tests', target: 'd16' },
      { query: 'Vitest runner', target: 'd17' },
      { query: 'Biome lint', target: 'd18' },
      { query: 'Prettier format', target: 'd19' },
      { query: 'ESLint bugs', target: 'd20' },
    ];

    let hits = 0;
    const misses: string[] = [];
    for (const q of queries) {
      const r = hybridRetrieve({
        queryText: q.query,
        candidates: docs,
        topK: 5,
      });
      const found = r.hits.some((h) => h.id === q.target);
      if (found) hits++;
      else misses.push(`${q.query} → wanted ${q.target}, got [${r.hits.map((h) => h.id).join(',')}]`);
    }
    const recall = hits / queries.length;
    if (recall < 0.8) {
      throw new Error(
        `Recall@5 = ${(recall * 100).toFixed(1)}% < 80%.\nMisses:\n${misses.join('\n')}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });
});

// =============================================================================
// Determinism
// =============================================================================

describe('deterministic ordering', () => {
  it('same input → same output order twice', () => {
    const docs = [
      mem({ id: 'a', text: 'alpha beta gamma' }),
      mem({ id: 'b', text: 'beta gamma delta' }),
      mem({ id: 'c', text: 'gamma delta epsilon' }),
    ];
    const r1 = hybridRetrieve({ queryText: 'beta', candidates: docs });
    const r2 = hybridRetrieve({ queryText: 'beta', candidates: docs });
    expect(r1.hits.map((h) => h.id)).toEqual(r2.hits.map((h) => h.id));
  });

  it('ties broken by id lexical order', () => {
    const docs = [
      mem({ id: 'z', text: 'unrelated words' }),
      mem({ id: 'a', text: 'unrelated words' }),
      mem({ id: 'm', text: 'unrelated words' }),
    ];
    const r = hybridRetrieve({ queryText: 'nomatch', candidates: docs });
    expect(r.hits.map((h) => h.id)).toEqual(['a', 'm', 'z']);
  });
});

// =============================================================================
// topK boundary
// =============================================================================

describe('topK', () => {
  it('default topK = 5', () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      mem({ id: `d${i}`, text: 'word' }),
    );
    const r = hybridRetrieve({ queryText: 'word', candidates: docs });
    expect(r.hits.length).toBe(5);
  });

  it('custom topK respected', () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      mem({ id: `d${i}`, text: 'word' }),
    );
    const r = hybridRetrieve({ queryText: 'word', candidates: docs, topK: 3 });
    expect(r.hits.length).toBe(3);
  });

  it('empty candidates → empty hits', () => {
    const r = hybridRetrieve({ queryText: 'anything', candidates: [] });
    expect(r.hits.length).toBe(0);
  });
});
// === FILE END ===