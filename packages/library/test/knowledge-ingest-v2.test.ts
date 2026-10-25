// === FILE START ===
// packages/library/test/knowledge-ingest-v2.test.ts
// PRD 9.10 · FR-KNOW-01 to FR-KNOW-07.
//
// Every gate: type detect, chunking, hash, embedding cache, claims,
// entities, cap enforcement, quote match, 300-page PDF, real counts.

import { describe, it, expect } from 'vitest';
import {
  detectType,
  extractContent,
  chunkPage,
  hashText,
  embedChunks,
  extractClaims,
  extractEntities,
  ingestFile,
  findQuoteInFile,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MAX_CHUNKS_PER_PROFILE,
  MAX_VECTOR_MB,
  VECTOR_BYTES,
  type Chunk,
  type EmbeddingFn,
  type FileType,
} from '../src/knowledge-ingest-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const fakeEmbed: EmbeddingFn = (text: string): Int8Array => {
  const v = new Int8Array(768);
  for (let i = 0; i < Math.min(text.length, 768); i++) {
    v[i] = Math.max(-127, Math.min(127, (text.charCodeAt(i) - 128) | 0));
  }
  return v;
};

function build300PagePdf(): string {
  const pages: string[] = [];
  for (let i = 1; i <= 300; i++) {
    const words = Array.from({ length: 200 }, (_, j) => `word${i}_${j}`).join(' ');
    pages.push(
      `Page ${i}. ${words}. Company XYZ reported revenue of ${i} million dollars in 2024.`,
    );
  }
  return pages.join('\f');
}

function buildMultiChunkText(numChunks: number): string {
  // To produce N chunks with size=1000, overlap=100, need
  // length ≈ (N-1) * 900 + 200.
  const target = (numChunks - 1) * (CHUNK_SIZE - CHUNK_OVERLAP) + 200;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < target; i++) out += alphabet[i % alphabet.length];
  return out;
}

// =============================================================================
// Constants
// =============================================================================

describe('constants (PRD 9.10 · FR-KNOW-05)', () => {
  it('CHUNK_SIZE = 1000', () => {
    expect(CHUNK_SIZE).toBe(1000);
  });
  it('CHUNK_OVERLAP = 100', () => {
    expect(CHUNK_OVERLAP).toBe(100);
  });
  it('MAX_CHUNKS_PER_PROFILE = 20,000', () => {
    expect(MAX_CHUNKS_PER_PROFILE).toBe(20000);
  });
  it('MAX_VECTOR_MB = 40', () => {
    expect(MAX_VECTOR_MB).toBe(40);
  });
  it('VECTOR_BYTES = 768', () => {
    expect(VECTOR_BYTES).toBe(768);
  });
});

// =============================================================================
// detectType
// =============================================================================

describe('detectType', () => {
  const cases: Array<[string, string | undefined, FileType]> = [
    ['doc.pdf', undefined, 'pdf'],
    ['notes.md', undefined, 'md'],
    ['README.markdown', undefined, 'md'],
    ['data.csv', undefined, 'csv'],
    ['report.docx', undefined, 'docx'],
    ['readme.txt', undefined, 'txt'],
    ['https://example.com/page', undefined, 'url'],
    ['mystery', undefined, 'txt'],
    ['file.bin', 'application/pdf', 'pdf'],
    ['file.bin', 'text/csv', 'csv'],
    ['file.bin', 'text/html', 'url'],
  ];
  for (const [name, mime, expected] of cases) {
    it(`"${name}" (${mime ?? 'no mime'}) → ${expected}`, () => {
      expect(detectType(name, mime)).toBe(expected);
    });
  }
});

// =============================================================================
// hashText
// =============================================================================

describe('hashText', () => {
  it('deterministic', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
  });
  it('different text → different hash', () => {
    expect(hashText('hello')).not.toBe(hashText('world'));
  });
  it('empty string produces a valid 8-hex hash', () => {
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('always 8 hex chars', () => {
    for (const t of ['a', 'hello world', 'x'.repeat(5000)]) {
      expect(hashText(t)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

// =============================================================================
// extractContent
// =============================================================================

describe('extractContent — page boundaries', () => {
  it('PDF: \\f splits pages', () => {
    const ex = extractContent(
      { fileId: 'f', name: 'x.pdf', content: 'page1\fpage2\fpage3' },
      'pdf',
    );
    expect(ex.pages.length).toBe(3);
    expect(ex.pages.map((p) => p.pageNum)).toEqual([1, 2, 3]);
  });
  it('MD: --- on its own line splits sections', () => {
    const ex = extractContent(
      { fileId: 'f', name: 'x.md', content: '# a\n---\n# b\n---\n# c' },
      'md',
    );
    expect(ex.pages.length).toBe(3);
  });
  it('CSV: batches of 100 rows', () => {
    const rows = Array.from({ length: 250 }, (_, i) => `row${i}`);
    const ex = extractContent(
      { fileId: 'f', name: 'x.csv', content: rows.join('\n') },
      'csv',
    );
    expect(ex.pages.length).toBe(3); // 100 + 100 + 50
  });
  it('TXT: single page', () => {
    const ex = extractContent(
      { fileId: 'f', name: 'x.txt', content: 'hello\nworld' },
      'txt',
    );
    expect(ex.pages.length).toBe(1);
  });
});

// =============================================================================
// chunkPage
// =============================================================================

describe('chunkPage', () => {
  it('short text → 1 chunk', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'short' }, 0);
    expect(c.length).toBe(1);
    expect(c[0].text).toBe('short');
  });
  it('1000 chars → 1 chunk', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'a'.repeat(1000) }, 0);
    expect(c.length).toBe(1);
  });
  it('1005 chars → 2 chunks', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'a'.repeat(1005) }, 0);
    expect(c.length).toBe(2);
  });
  it('each chunk ≤ CHUNK_SIZE', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'x'.repeat(5000) }, 0);
    for (const ch of c) expect(ch.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });
  it('chunks overlap by CHUNK_OVERLAP', () => {
    // Use unique alphabetic text so chunk boundaries are unambiguous
    const text = Array.from({ length: 2000 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)),
    ).join('');
    const c = chunkPage('f', { pageNum: 1, text }, 0);
    expect(c.length).toBeGreaterThanOrEqual(2);
    const tail = c[0].text.slice(-CHUNK_OVERLAP);
    const head = c[1].text.slice(0, CHUNK_OVERLAP);
    expect(tail).toBe(head);
  });
  it('ord is sequential from startOrd', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'a'.repeat(5000) }, 10);
    c.forEach((ch, i) => expect(ch.ord).toBe(10 + i));
  });
  it('each chunk carries contentHash', () => {
    const c = chunkPage('f', { pageNum: 1, text: 'hello world' }, 0);
    expect(c[0].contentHash).toMatch(/^[0-9a-f]{8}$/);
  });
  it('empty page → 0 chunks', () => {
    expect(chunkPage('f', { pageNum: 1, text: '' }, 0).length).toBe(0);
  });
});

// =============================================================================
// FR-KNOW-01 — each file type yields chunks + entities + claims
// =============================================================================

describe('FR-KNOW-01 — each file type yields chunks + entities + claims', () => {
  const sampleText =
    'The Company XYZ reported revenue of 100 million dollars in 2024.';

  it('txt', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'a.txt', content: sampleText, type: 'txt' },
      { embed: fakeEmbed },
    );
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.entities.length).toBeGreaterThan(0);
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it('md', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'a.md', content: '# Header\n' + sampleText, type: 'md' },
      { embed: fakeEmbed },
    );
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it('csv', () => {
    const r = ingestFile(
      {
        fileId: 'f1',
        name: 'a.csv',
        content: 'name,amount\nAura-lie,100\nAcme Corp,250',
        type: 'csv',
      },
      { embed: fakeEmbed },
    );
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it('pdf', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'a.pdf', content: sampleText, type: 'pdf' },
      { embed: fakeEmbed },
    );
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it('url', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'https://example.com', content: sampleText, type: 'url' },
      { embed: fakeEmbed },
    );
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.claims.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// FR-KNOW-02 — 300-page PDF
// =============================================================================

describe('FR-KNOW-02 — 300-page PDF, all pages present', () => {
  it('300 pages → pageCount=300, all pages chunked', () => {
    const r = ingestFile(
      { fileId: 'big', name: 'big.pdf', content: build300PagePdf(), type: 'pdf' },
      { embed: fakeEmbed },
    );
    expect(r.file.pageCount).toBe(300);
    expect(r.chunks.length).toBeGreaterThan(300);
    const pageSet = new Set(r.chunks.map((c) => c.page));
    expect(pageSet.size).toBe(300);
    expect(r.file.capExceeded).toBe(false);
  });

  it('every chunk has page ∈ [1, 300]', () => {
    const r = ingestFile(
      { fileId: 'big', name: 'big.pdf', content: build300PagePdf(), type: 'pdf' },
      { embed: fakeEmbed },
    );
    for (const c of r.chunks) {
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.page).toBeLessThanOrEqual(300);
    }
  });
});

// =============================================================================
// FR-KNOW-03 — embedding cache
// =============================================================================

describe('FR-KNOW-03 — embedding cache by content hash', () => {
  it('5 identical chunks → 1 miss, 4 hits (exactly 1 compute)', () => {
    const text = 'identical text';
    const h = hashText(text);
    const chunks: Chunk[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      fileId: 'f1',
      ord: i,
      page: 1,
      text,
      contentHash: h,
    }));
    let computeCount = 0;
    const embed: EmbeddingFn = (t) => {
      computeCount++;
      return fakeEmbed(t);
    };
    const cache = new Map<string, Int8Array>();
    const stats = embedChunks(chunks, embed, cache);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheHits).toBe(4);
    expect(computeCount).toBe(1);
  });

  it('5 unique chunks → 5 misses, 0 hits', () => {
    const chunks: Chunk[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      fileId: 'f1',
      ord: i,
      page: 1,
      text: `unique ${i}`,
      contentHash: hashText(`unique ${i}`),
    }));
    const cache = new Map<string, Int8Array>();
    const stats = embedChunks(chunks, fakeEmbed, cache);
    expect(stats.cacheMisses).toBe(5);
    expect(stats.cacheHits).toBe(0);
  });

  it('cache persists across ingests of the same content', () => {
    const cache = new Map<string, Int8Array>();
    const content =
      'The Company XYZ reported revenue of 100 million dollars in 2024.';
    const r1 = ingestFile(
      { fileId: 'f1', name: 'a.txt', content, type: 'txt' },
      { embed: fakeEmbed, cache },
    );
    const r2 = ingestFile(
      { fileId: 'f2', name: 'b.txt', content, type: 'txt' },
      { embed: fakeEmbed, cache },
    );
    expect(r1.file.cacheMisses).toBeGreaterThan(0);
    expect(r2.file.cacheMisses).toBe(0);
    expect(r2.file.cacheHits).toBe(r2.file.chunkCount);
  });
});

// =============================================================================
// FR-KNOW-04 — real counts
// =============================================================================

describe('FR-KNOW-04 — real counts', () => {
  it('entityCount / claimCount / chunkCount match array lengths', () => {
    const r = ingestFile(
      {
        fileId: 'f1',
        name: 'a.txt',
        content: 'The Company XYZ reported revenue of 100 million dollars in 2024.',
        type: 'txt',
      },
      { embed: fakeEmbed },
    );
    expect(r.file.entityCount).toBe(r.entities.length);
    expect(r.file.claimCount).toBe(r.claims.length);
    expect(r.file.chunkCount).toBe(r.chunks.length);
  });

  it('uniqueEmbeddingCount = unique content hashes', () => {
    const r = ingestFile(
      {
        fileId: 'f1',
        name: 'a.txt',
        content: 'The Company XYZ reported revenue of 100 million dollars in 2024.',
        type: 'txt',
      },
      { embed: fakeEmbed },
    );
    const hashes = new Set(r.chunks.map((c) => c.contentHash));
    expect(r.file.uniqueEmbeddingCount).toBe(hashes.size);
  });

  it('vectorSizeBytes = uniqueEmbeddingCount × 768', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'a.txt', content: 'Short content.', type: 'txt' },
      { embed: fakeEmbed },
    );
    expect(r.file.vectorSizeBytes).toBe(r.file.uniqueEmbeddingCount * VECTOR_BYTES);
  });
});

// =============================================================================
// FR-KNOW-05 — chunk cap + vector cap
// =============================================================================

describe('FR-KNOW-05 — 20k chunk cap', () => {
  it('maxChunksPerProfile=5 + 10-chunk input → 5 stored, capExceeded=true', () => {
    const content = buildMultiChunkText(10);
    const r = ingestFile(
      { fileId: 'f1', name: 'big.txt', content, type: 'txt' },
      { embed: fakeEmbed, maxChunksPerProfile: 5 },
    );
    expect(r.file.chunkCount).toBe(5);
    expect(r.file.capExceeded).toBe(true);
  });

  it('existingChunkCount reduces remaining budget', () => {
    const content = buildMultiChunkText(10);
    const r = ingestFile(
      { fileId: 'f1', name: 'big.txt', content, type: 'txt' },
      { embed: fakeEmbed, maxChunksPerProfile: 20, existingChunkCount: 18 },
    );
    expect(r.file.chunkCount).toBe(2);
    expect(r.file.capExceeded).toBe(true);
  });

  it('under cap → capExceeded=false', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'small.txt', content: 'short', type: 'txt' },
      { embed: fakeEmbed, maxChunksPerProfile: 20 },
    );
    expect(r.file.capExceeded).toBe(false);
  });
});

// =============================================================================
// FR-KNOW-06 — quote match
// =============================================================================

describe('FR-KNOW-06 — quote match against local file text', () => {
  it('exact substring → hit with correct fileId and page', () => {
    const content =
      'The Company XYZ reported revenue of 100 million dollars in 2024.';
    const r = ingestFile(
      { fileId: 'f1', name: 'a.txt', content, type: 'txt' },
      { embed: fakeEmbed },
    );
    const hits = findQuoteInFile('f1', 'revenue of 100 million dollars', {
      chunks: r.chunks,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].fileId).toBe('f1');
    expect(hits[0].page).toBe(1);
  });

  it('quote not in file → no hits', () => {
    const r = ingestFile(
      {
        fileId: 'f1',
        name: 'a.txt',
        content: 'The Company XYZ reported revenue of 100 million dollars in 2024.',
        type: 'txt',
      },
      { embed: fakeEmbed },
    );
    expect(findQuoteInFile('f1', 'totally unrelated', { chunks: r.chunks }).length).toBe(0);
  });

  it('quote from another file → no hits for the requested file', () => {
    const r = ingestFile(
      {
        fileId: 'f1',
        name: 'a.txt',
        content: 'The Company XYZ reported revenue of 100 million dollars in 2024.',
        type: 'txt',
      },
      { embed: fakeEmbed },
    );
    expect(findQuoteInFile('f2', 'revenue of 100 million', { chunks: r.chunks }).length).toBe(0);
  });

  it('empty quote → no hits', () => {
    const r = ingestFile(
      { fileId: 'f1', name: 'a.txt', content: 'anything here', type: 'txt' },
      { embed: fakeEmbed },
    );
    expect(findQuoteInFile('f1', '', { chunks: r.chunks }).length).toBe(0);
    expect(findQuoteInFile('f1', '   ', { chunks: r.chunks }).length).toBe(0);
  });
});

// =============================================================================
// extractClaims — behaviour
// =============================================================================

describe('extractClaims', () => {
  it('sentence with numbers → claim', () => {
    const claims = extractClaims([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'The value is 42.',
        contentHash: 'abc',
      },
    ]);
    expect(claims.length).toBe(1);
    expect(claims[0].hasNumeric).toBe(true);
  });

  it('no numbers → no claim', () => {
    const claims = extractClaims([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'Hello there friend.',
        contentHash: 'abc',
      },
    ]);
    expect(claims.length).toBe(0);
  });

  it('percentage token → claim', () => {
    const claims = extractClaims([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'The efficiency was 41%.',
        contentHash: 'abc',
      },
    ]);
    expect(claims.length).toBe(1);
  });
});

// =============================================================================
// extractEntities — behaviour
// =============================================================================

describe('extractEntities', () => {
  it('mid-sentence proper nouns extracted', () => {
    const entities = extractEntities([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'The Company XYZ reported 100 million.',
        contentHash: 'abc',
      },
    ]);
    const names = entities.filter((e) => e.type === 'proper-noun').map((e) => e.text);
    expect(names).toContain('Company');
    expect(names).toContain('XYZ');
  });

  it('numeric tokens extracted', () => {
    const entities = extractEntities([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'The value is 42 and the percentage is 100%.',
        contentHash: 'abc',
      },
    ]);
    const nums = entities.filter((e) => e.type === 'numeric').map((e) => e.text);
    expect(nums).toContain('42');
    expect(nums).toContain('100%');
  });

  it('sentence-start words are NOT extracted as proper nouns', () => {
    const entities = extractEntities([
      {
        id: 'c1',
        fileId: 'f1',
        ord: 0,
        page: 1,
        text: 'Company sits at the start.',
        contentHash: 'abc',
      },
    ]);
    const names = entities.filter((e) => e.type === 'proper-noun').map((e) => e.text);
    expect(names).not.toContain('Company');
  });
});
// === FILE END ===