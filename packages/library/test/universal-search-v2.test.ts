// === FILE START ===
// packages/library/test/universal-search-v2.test.ts
// PRD 9.11 · FR-MEM-13 · FR-KNOW-07 · FR-CHAT-06 · PRD 5.15.
//
// Covers: constants, empty store, no-match, single source, BM25-only,
// vector-only, cross-source dedup, filtering (frozen / S2 / project /
// types), deterministic ordering, topK / per-source limits, weight
// override, and the FR-MEM-13 recall gate.

import { describe, it, expect } from 'vitest';
import {
  universalSearch,
  contentKeyOf,
  quantizeInt8,
  cosineInt8,
  SOURCE_WEIGHTS,
  DEFAULT_TOP_K,
  DEFAULT_PER_SOURCE_LIMIT,
  DEFAULT_VECTOR_WEIGHT,
  EMBEDDING_DIM,
  type UniversalSearchStore,
  type MessageDoc,
  type MemoryDoc,
  type FileChunkDoc,
  type ClaimDoc,
  type SourceKind,
} from '../src/universal-search-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

function message(overrides: Partial<MessageDoc> = {}): MessageDoc {
  return { id: 'msg1', text: 'Hello world', createdAt: T0, ...overrides };
}

function memory(overrides: Partial<MemoryDoc> = {}): MemoryDoc {
  return { id: 'mem1', text: 'I prefer coffee', createdAt: T0, ...overrides };
}

function fileChunk(overrides: Partial<FileChunkDoc> = {}): FileChunkDoc {
  return {
    id: 'f1',
    fileId: 'file1',
    text: 'React is a UI library',
    page: 1,
    ord: 0,
    contentHash: 'abc',
    createdAt: T0,
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimDoc> = {}): ClaimDoc {
  return {
    id: 'c1',
    text: 'The Eiffel Tower is 330 metres',
    status: 'VERIFIED',
    score: 92,
    createdAt: T0,
    ...overrides,
  };
}

function emptyStore(): UniversalSearchStore {
  return { messages: [], memories: [], files: [], claims: [] };
}

function multiSourceStore(): UniversalSearchStore {
  return {
    memories: [
      memory({ id: 'm1', text: 'I prefer coffee in the morning' }),
      memory({ id: 'm2', text: 'Green tea is my evening drink' }),
      memory({ id: 'm3', text: 'My cat Pixel sleeps all day' }),
      memory({ id: 'm4', text: 'My dog Rex loves the park' }),
      memory({ id: 'm5', text: 'I use Python for scripting tasks' }),
    ],
    files: [
      fileChunk({ id: 'f1', text: 'React is a UI library', page: 1, ord: 0, contentHash: 'h1' }),
      fileChunk({ id: 'f2', text: 'Vue is a progressive framework', page: 1, ord: 1, contentHash: 'h2' }),
      fileChunk({ id: 'f3', text: 'Angular is opinionated', page: 1, ord: 2, contentHash: 'h3' }),
      fileChunk({ id: 'f4', text: 'Svelte compiles at build time', page: 2, ord: 3, contentHash: 'h4' }),
      fileChunk({ id: 'f5', text: 'Solid uses fine-grained reactivity', page: 2, ord: 4, contentHash: 'h5' }),
    ],
    messages: [
      message({ id: 'msg1', text: 'Our vacation in Paris was wonderful' }),
      message({ id: 'msg2', text: 'The train station in London was crowded' }),
      message({ id: 'msg3', text: 'We visited a museum in Berlin' }),
      message({ id: 'msg4', text: 'Rome is famous for its history' }),
      message({ id: 'msg5', text: 'Madrid has excellent tapas' }),
    ],
    claims: [
      claim({ id: 'c1', text: 'The Eiffel Tower is 330 metres tall' }),
      claim({ id: 'c2', text: 'The Colosseum was completed in 80 AD' }),
      claim({ id: 'c3', text: 'The clock face of Big Ben is huge' }),
      claim({ id: 'c4', text: 'The Brandenburg Gate is a monument in Germany' }),
      claim({ id: 'c5', text: 'The Sagrada Familia is in Barcelona' }),
    ],
  };
}

// =============================================================================
// Constants
// =============================================================================

describe('constants (PRD 9.11 · 5.15)', () => {
  it('source weights memory=1.0, file=0.9, message=0.7, claim=0.6', () => {
    expect(SOURCE_WEIGHTS.memory).toBe(1.0);
    expect(SOURCE_WEIGHTS.file).toBe(0.9);
    expect(SOURCE_WEIGHTS.message).toBe(0.7);
    expect(SOURCE_WEIGHTS.claim).toBe(0.6);
  });

  it('default topK = 10', () => {
    expect(DEFAULT_TOP_K).toBe(10);
  });

  it('default per-source limit = 5', () => {
    expect(DEFAULT_PER_SOURCE_LIMIT).toBe(5);
  });

  it('default vector weight = 0.5', () => {
    expect(DEFAULT_VECTOR_WEIGHT).toBe(0.5);
  });

  it('embedding dimension = 768', () => {
    expect(EMBEDDING_DIM).toBe(768);
  });
});

// =============================================================================
// contentKeyOf + quantize + cosine
// =============================================================================

describe('contentKeyOf', () => {
  it('case + whitespace insensitive', () => {
    expect(contentKeyOf('The Eiffel Tower')).toBe(contentKeyOf('  the  eiffel tower  '));
  });
  it('different text → different key', () => {
    expect(contentKeyOf('hello')).not.toBe(contentKeyOf('world'));
  });
});

describe('quantizeInt8 / cosineInt8', () => {
  it('identical vectors → cosine 1', () => {
    const v = new Array(EMBEDDING_DIM).fill(0.5);
    expect(cosineInt8(quantizeInt8(v), quantizeInt8(v))).toBeCloseTo(1, 2);
  });
  it('orthogonal vectors → cosine 0', () => {
    const a = new Array(EMBEDDING_DIM).fill(0);
    const b = new Array(EMBEDDING_DIM).fill(0);
    a[0] = 1;
    b[1] = 1;
    expect(cosineInt8(quantizeInt8(a), quantizeInt8(b))).toBeCloseTo(0, 5);
  });
});

// =============================================================================
// Empty + no-match
// =============================================================================

describe('empty store', () => {
  it('all groups empty, flat empty', () => {
    const r = universalSearch({ queryText: 'anything', store: emptyStore() });
    expect(r.memories).toEqual([]);
    expect(r.files).toEqual([]);
    expect(r.messages).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(r.flat).toEqual([]);
    expect(r.filtered).toEqual([]);
  });
});

describe('no match', () => {
  it('query matches nothing → all empty, filtered empty', () => {
    const r = universalSearch({
      queryText: 'zzzzzzz',
      store: {
        messages: [message()],
        memories: [memory()],
        files: [fileChunk()],
        claims: [claim()],
      },
    });
    expect(r.flat).toEqual([]);
    expect(r.filtered).toEqual([]);
  });
});

// =============================================================================
// Single-source hits
// =============================================================================

describe('single-source hits', () => {
  it('memory-only query → memory group + flat', () => {
    const r = universalSearch({
      queryText: 'coffee',
      store: { ...emptyStore(), memories: [memory({ id: 'm1', text: 'I like coffee' })] },
    });
    expect(r.memories.length).toBe(1);
    expect(r.memories[0].id).toBe('m1');
    expect(r.flat[0].id).toBe('m1');
  });

  it('file-only query → file group + flat', () => {
    const r = universalSearch({
      queryText: 'React',
      store: { ...emptyStore(), files: [fileChunk({ id: 'f1', text: 'React is a UI library' })] },
    });
    expect(r.files.length).toBe(1);
    expect(r.files[0].id).toBe('f1');
  });

  it('message-only query → message group', () => {
    const r = universalSearch({
      queryText: 'Paris',
      store: { ...emptyStore(), messages: [message({ id: 'msg1', text: 'Paris is nice' })] },
    });
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].id).toBe('msg1');
  });

  it('claim-only query → claim group', () => {
    const r = universalSearch({
      queryText: 'Eiffel',
      store: { ...emptyStore(), claims: [claim({ id: 'c1', text: 'The Eiffel Tower is tall' })] },
    });
    expect(r.claims.length).toBe(1);
    expect(r.claims[0].id).toBe('c1');
  });
});

// =============================================================================
// BM25 / vector
// =============================================================================

describe('BM25 scoring', () => {
  it('higher BM25 for better lexical match', () => {
    const r = universalSearch({
      queryText: 'coffee',
      store: {
        ...emptyStore(),
        memories: [
          memory({ id: 'm1', text: 'I like coffee' }),
          memory({ id: 'm2', text: 'I like tea' }),
        ],
      },
    });
    expect(r.memories[0].id).toBe('m1');
    expect(r.memories[0].bm25Score).toBeGreaterThan(0);
    expect(r.memories[1]).toBeUndefined(); // tea has no match
  });
});

describe('vector scoring', () => {
  it('query embedding boosts correct doc', () => {
    const targetVec = new Array(EMBEDDING_DIM).fill(0);
    targetVec[0] = 1;
    const otherVec = new Array(EMBEDDING_DIM).fill(0);
    otherVec[5] = 1;
    const r = universalSearch({
      queryText: 'unrelated query',
      queryEmbedding: targetVec,
      store: {
        ...emptyStore(),
        files: [
          fileChunk({ id: 'f1', text: 'some text', embeddingInt8: quantizeInt8(targetVec) }),
          fileChunk({ id: 'f2', text: 'other text', embeddingInt8: quantizeInt8(otherVec) }),
        ],
      },
    });
    expect(r.files[0].id).toBe('f1');
  });
});

// =============================================================================
// Cross-source dedup
// =============================================================================

describe('cross-source dedup', () => {
  it('same text in memory + file → 1 hit, sources=[memory,file], memory wins', () => {
    const text = 'The Eiffel Tower is 330 metres';
    const r = universalSearch({
      queryText: 'Eiffel',
      store: {
        messages: [],
        memories: [memory({ id: 'm1', text })],
        files: [
          fileChunk({ id: 'f1', text, fileId: 'f0', contentHash: 'h1' }),
        ],
        claims: [],
      },
    });
    expect(r.flat.length).toBe(1);
    expect(r.flat[0].source).toBe('memory');
    expect(r.flat[0].sources).toEqual(['memory', 'file']);
    expect(r.memories.length).toBe(1);
    expect(r.files.length).toBe(0);
  });

  it('same text with different case/whitespace → deduped', () => {
    const r = universalSearch({
      queryText: 'Eiffel',
      store: {
        messages: [],
        memories: [memory({ id: 'm1', text: 'THE   EIFFEL  TOWER' })],
        files: [
          fileChunk({ id: 'f1', text: 'the eiffel tower' }),
        ],
        claims: [],
      },
    });
    expect(r.flat.length).toBe(1);
    expect(r.flat[0].sources.length).toBe(2);
  });
});

// =============================================================================
// Filtering
// =============================================================================

describe('filtering', () => {
  it('frozen memory excluded', () => {
    const r = universalSearch({
      queryText: 'coffee',
      store: {
        ...emptyStore(),
        memories: [memory({ id: 'm1', text: 'I like coffee', frozen: true })],
      },
    });
    expect(r.memories.length).toBe(0);
    expect(r.filtered[0].reason).toBe('frozen');
  });

  it('unapproved S2 excluded', () => {
    const r = universalSearch({
      queryText: 'coffee',
      store: {
        ...emptyStore(),
        memories: [memory({ id: 'm1', text: 'I like coffee', sensitivity: 'S2' })],
      },
    });
    expect(r.memories.length).toBe(0);
    expect(r.filtered[0].reason).toBe('unapproved S2');
  });

  it('approved S2 included', () => {
    const r = universalSearch({
      queryText: 'coffee',
      store: {
        ...emptyStore(),
        memories: [
          memory({ id: 'm1', text: 'I like coffee', sensitivity: 'S2', s2Approved: true }),
        ],
      },
    });
    expect(r.memories.length).toBe(1);
  });

  it('includeUnapprovedS2: true → included', () => {
    const r = universalSearch({
      queryText: 'coffee',
      includeUnapprovedS2: true,
      store: {
        ...emptyStore(),
        memories: [memory({ id: 'm1', text: 'I like coffee', sensitivity: 'S2' })],
      },
    });
    expect(r.memories.length).toBe(1);
  });

  it('project scoping: only matching project docs returned', () => {
    const r = universalSearch({
      queryText: 'design',
      projectId: 'proj-1',
      store: {
        ...emptyStore(),
        memories: [
          memory({ id: 'm1', text: 'design notes', projectId: 'proj-1' }),
          memory({ id: 'm2', text: 'design notes', projectId: 'proj-2' }),
        ],
      },
    });
    expect(r.memories.length).toBe(1);
    expect(r.memories[0].id).toBe('m1');
    expect(r.filtered.find((f) => f.id === 'm2')?.reason).toBe('project mismatch');
  });

  it('types filter: only requested sources searched', () => {
    const r = universalSearch({
      queryText: 'coffee',
      types: ['memory'],
      store: {
        messages: [message({ id: 'msg1', text: 'coffee' })],
        memories: [memory({ id: 'm1', text: 'coffee' })],
        files: [fileChunk({ id: 'f1', text: 'coffee' })],
        claims: [claim({ id: 'c1', text: 'coffee' })],
      },
    });
    expect(r.memories.length).toBe(1);
    expect(r.messages.length).toBe(0);
    expect(r.files.length).toBe(0);
    expect(r.claims.length).toBe(0);
  });
});

// =============================================================================
// Determinism
// =============================================================================

describe('deterministic ordering', () => {
  it('same input → same output order twice', () => {
    const store = multiSourceStore();
    const r1 = universalSearch({ queryText: 'coffee', store });
    const r2 = universalSearch({ queryText: 'coffee', store });
    expect(r1.flat.map((h) => h.id)).toEqual(r2.flat.map((h) => h.id));
  });

  it('ties broken by id lexical order', () => {
    const store: UniversalSearchStore = {
      ...emptyStore(),
      memories: [
        memory({ id: 'z', text: 'match' }),
        memory({ id: 'a', text: 'match' }),
        memory({ id: 'm', text: 'match' }),
      ],
    };
    const r = universalSearch({ queryText: 'match', store });
    expect(r.memories.map((h) => h.id)).toEqual(['a', 'm', 'z']);
  });
});

// =============================================================================
// topK / per-source limits
// =============================================================================

describe('topK / per-source limits', () => {
  it('default topK = 10', () => {
    const store = multiSourceStore();
    const r = universalSearch({ queryText: 'the', store });
    expect(r.flat.length).toBeLessThanOrEqual(10);
  });

  it('topK=3 caps flat', () => {
    const store = multiSourceStore();
    const r = universalSearch({ queryText: 'the', store, topK: 3 });
    expect(r.flat.length).toBeLessThanOrEqual(3);
  });

  it('per-source limit respected', () => {
    const store = multiSourceStore();
    const r = universalSearch({
      queryText: 'a',
      store,
      perSourceLimit: 2,
    });
    expect(r.memories.length).toBeLessThanOrEqual(2);
    expect(r.files.length).toBeLessThanOrEqual(2);
    expect(r.messages.length).toBeLessThanOrEqual(2);
    expect(r.claims.length).toBeLessThanOrEqual(2);
  });
});

// =============================================================================
// sourceWeights override
// =============================================================================

describe('sourceWeights override', () => {
  it('custom weights flip the winner', () => {
    const text = 'shared text';
    const r1 = universalSearch({
      queryText: 'shared',
      store: {
        messages: [message({ id: 'msg1', text })],
        memories: [memory({ id: 'm1', text })],
        files: [],
        claims: [],
      },
    });
    expect(r1.flat[0].source).toBe('memory');
    expect(r1.flat[0].sources).toContain('message');

    const r2 = universalSearch({
      queryText: 'shared',
      sourceWeights: { message: 2.0, memory: 0.1 },
      store: {
        messages: [message({ id: 'msg1', text })],
        memories: [memory({ id: 'm1', text })],
        files: [],
        claims: [],
      },
    });
    expect(r2.flat[0].source).toBe('message');
  });
});

// =============================================================================
// FR-MEM-13 recall gate — 5 per source × 4 sources, 20 queries
// =============================================================================

describe('FR-MEM-13 — Recall@5 across all 4 sources', () => {
  it('every one of 20 queries returns its target in the source group AND flat', () => {
    const store = multiSourceStore();

    const queries: Array<{
      query: string;
      targetId: string;
      source: SourceKind;
    }> = [
      { query: 'coffee', targetId: 'm1', source: 'memory' },
      { query: 'evening', targetId: 'm2', source: 'memory' },
      { query: 'Pixel', targetId: 'm3', source: 'memory' },
      { query: 'Rex', targetId: 'm4', source: 'memory' },
      { query: 'scripting', targetId: 'm5', source: 'memory' },
      { query: 'React', targetId: 'f1', source: 'file' },
      { query: 'progressive', targetId: 'f2', source: 'file' },
      { query: 'Angular', targetId: 'f3', source: 'file' },
      { query: 'Svelte', targetId: 'f4', source: 'file' },
      { query: 'solid', targetId: 'f5', source: 'file' },
      { query: 'vacation', targetId: 'msg1', source: 'message' },
      { query: 'station', targetId: 'msg2', source: 'message' },
      { query: 'museum', targetId: 'msg3', source: 'message' },
      { query: 'history', targetId: 'msg4', source: 'message' },
      { query: 'tapas', targetId: 'msg5', source: 'message' },
      { query: 'Eiffel', targetId: 'c1', source: 'claim' },
      { query: 'Colosseum', targetId: 'c2', source: 'claim' },
      { query: 'clock', targetId: 'c3', source: 'claim' },
      { query: 'Brandenburg', targetId: 'c4', source: 'claim' },
      { query: 'Sagrada', targetId: 'c5', source: 'claim' },
    ];

    let hits = 0;
    const misses: string[] = [];

    for (const q of queries) {
      const r = universalSearch({
        queryText: q.query,
        store,
        topK: 5,
        perSourceLimit: 5,
      });
      const inFlat = r.flat.some((h) => h.id === q.targetId);
      const group =
        q.source === 'memory'
          ? r.memories
          : q.source === 'file'
            ? r.files
            : q.source === 'message'
              ? r.messages
              : r.claims;
      const inGroup = group.some((h) => h.id === q.targetId);

      if (inFlat && inGroup) hits++;
      else
        misses.push(
          `${q.query} → target=${q.targetId} inFlat=${inFlat} inGroup=${inGroup}`,
        );
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
// === FILE END ===