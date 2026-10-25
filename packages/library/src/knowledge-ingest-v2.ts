// === FILE START ===
// packages/library/src/knowledge-ingest-v2.ts
// PRD 9.10 · FR-KNOW-01 through FR-KNOW-07 · F-071 to F-074.
//
// The knowledge ingestion pipeline. Turns a file into chunks, entities,
// claims, and cached embeddings.
//
// Pipeline (PRD 9.10):
//   type detect → extract text → chunk → embed → claims → entities → index
//
// Deterministic. No model in the loop — the only "intelligence" is the
// caller-supplied embedding function (Workers AI in production, a fake
// in tests) and the caller-supplied content (already extracted text).
//
// Storage budgets (FR-KNOW-05):
//   MAX_CHUNKS_PER_PROFILE = 20,000
//   MAX_VECTOR_MB = 40 (each chunk vector is 768 int8 bytes)
//   Whichever binds first sets capExceeded = true.
//
// Section 88 FIX (this revision):
//   Two regex bugs in extractEntities caught by knowledge-ingest-v2.test.ts:
//
//   1. Proper-noun pattern required capital + lowercase (`[A-Z][a-z]+`),
//      which rejected all-caps acronyms like "XYZ" or "USA". Fix: accept
//      either Title-Case OR 2+ uppercase-letter acronyms.
//
//   2. Numeric pattern ended with `\b`, but `%` is not a word character,
//      so the word boundary backtracked past the `%` and matched just
//      `100`. Fix: remove the trailing `\b` — numbers with `%` should keep
//      the suffix.

export type FileType = 'pdf' | 'docx' | 'md' | 'txt' | 'csv' | 'url';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 100;
export const MAX_CHUNKS_PER_PROFILE = 20_000;
export const MAX_VECTOR_MB = 40;
export const VECTOR_BYTES = 768;

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface PageText {
  pageNum: number;
  text: string;
}

export interface ExtractedContent {
  type: FileType;
  pages: PageText[];
  sourceUrl?: string;
}

export interface Chunk {
  id: string;
  fileId: string;
  ord: number;
  page: number;
  text: string;
  contentHash: string;
  embeddingInt8?: Int8Array;
  fromCache?: boolean;
}

export interface Entity {
  id: string;
  fileId: string;
  chunkId: string;
  text: string;
  type: 'proper-noun' | 'numeric';
}

export interface Claim {
  id: string;
  fileId: string;
  chunkId: string;
  text: string;
  hasNumeric: boolean;
  sourceSentence: string;
}

export interface IngestInput {
  fileId: string;
  name: string;
  mimeType?: string;
  content: string | Uint8Array;
  type?: FileType;
  sourceUrl?: string;
}

export interface IngestedFile {
  id: string;
  name: string;
  type: FileType;
  pageCount: number;
  chunkCount: number;
  entityCount: number;
  claimCount: number;
  uniqueEmbeddingCount: number;
  cacheHits: number;
  cacheMisses: number;
  vectorSizeBytes: number;
  capExceeded: boolean;
}

export interface IngestResult {
  file: IngestedFile;
  chunks: Chunk[];
  entities: Entity[];
  claims: Claim[];
}

export type EmbeddingFn = (text: string) => Int8Array;

export interface IngestOptions {
  embed: EmbeddingFn;
  cache?: Map<string, Int8Array>;
  maxChunksPerProfile?: number;
  existingChunkCount?: number;
}

// -----------------------------------------------------------------------------
// 1. Type detect
// -----------------------------------------------------------------------------

export function detectType(name: string, mimeType?: string): FileType {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.csv') || mimeType === 'text/csv') return 'csv';
  if (lower.endsWith('.txt') || mimeType === 'text/plain') return 'txt';
  if (/^https?:\/\//i.test(name) || mimeType === 'text/html') return 'url';
  return 'txt';
}

// -----------------------------------------------------------------------------
// 2. Extract — page boundaries per type
// -----------------------------------------------------------------------------

export function extractContent(input: IngestInput, type: FileType): ExtractedContent {
  const text =
    typeof input.content === 'string'
      ? input.content
      : new TextDecoder().decode(input.content);

  let pages: PageText[];

  switch (type) {
    case 'pdf': {
      const parts = text.split('\f').map((p, i) => ({ pageNum: i + 1, text: p.trim() }));
      pages = parts.filter((p) => p.text.length > 0);
      if (pages.length === 0) pages = [{ pageNum: 1, text: text.trim() }];
      break;
    }
    case 'md': {
      const parts = text
        .split(/^---$/m)
        .map((p, i) => ({ pageNum: i + 1, text: p.trim() }));
      pages = parts.filter((p) => p.text.length > 0);
      if (pages.length === 0) pages = [{ pageNum: 1, text: text.trim() }];
      break;
    }
    case 'csv': {
      const lines = text.split('\n');
      const chunks: PageText[] = [];
      for (let i = 0; i < lines.length; i += 100) {
        chunks.push({
          pageNum: chunks.length + 1,
          text: lines.slice(i, i + 100).join('\n'),
        });
      }
      pages = chunks;
      if (pages.length === 0) pages = [{ pageNum: 1, text: text.trim() }];
      break;
    }
    case 'docx':
    case 'url':
    case 'txt':
    default:
      pages = [{ pageNum: 1, text: text.trim() }];
  }

  return { type, pages, sourceUrl: input.sourceUrl };
}

// -----------------------------------------------------------------------------
// 3. Hash — content-addressed caching key
// -----------------------------------------------------------------------------

export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// -----------------------------------------------------------------------------
// 4. Chunk — 1000 chars, 100 char overlap
// -----------------------------------------------------------------------------

export function chunkPage(fileId: string, page: PageText, startOrd: number): Chunk[] {
  const out: Chunk[] = [];
  const text = page.text;
  if (text.length === 0) return out;
  let cursor = 0;
  let ord = startOrd;

  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + CHUNK_SIZE);
    const slice = text.slice(cursor, end).trim();
    if (slice.length > 0) {
      out.push({
        id: `${fileId}-c${ord}`,
        fileId,
        ord,
        page: page.pageNum,
        text: slice,
        contentHash: hashText(slice),
      });
      ord++;
    }
    if (end === text.length) break;
    cursor = end - CHUNK_OVERLAP;
    if (cursor <= 0) cursor = end;
  }
  return out;
}

// -----------------------------------------------------------------------------
// 5. Embed — cached by content hash
// -----------------------------------------------------------------------------

export interface EmbedStats {
  cacheHits: number;
  cacheMisses: number;
}

export function embedChunks(
  chunks: Chunk[],
  embed: EmbeddingFn,
  cache: Map<string, Int8Array>,
): EmbedStats {
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const chunk of chunks) {
    const cached = cache.get(chunk.contentHash);
    if (cached) {
      chunk.embeddingInt8 = cached;
      chunk.fromCache = true;
      cacheHits++;
    } else {
      const vec = embed(chunk.text);
      cache.set(chunk.contentHash, vec);
      chunk.embeddingInt8 = vec;
      chunk.fromCache = false;
      cacheMisses++;
    }
  }
  return { cacheHits, cacheMisses };
}

// -----------------------------------------------------------------------------
// 6. Claims — sentences with numeric tokens
// -----------------------------------------------------------------------------

const NUMERIC_TOKEN = /\b\d+(?:[.,]\d+)?%?\b/;
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z])/;

export function extractClaims(chunks: Chunk[]): Claim[] {
  const out: Claim[] = [];
  let id = 0;
  for (const chunk of chunks) {
    const sentences = chunk.text.split(SENTENCE_SPLIT);
    for (const raw of sentences) {
      const sent = raw.trim();
      if (sent.length < 12) continue;
      const hasNumeric = NUMERIC_TOKEN.test(sent);
      if (!hasNumeric) continue;
      out.push({
        id: `${chunk.fileId}-cl${id++}`,
        fileId: chunk.fileId,
        chunkId: chunk.id,
        text: sent,
        hasNumeric,
        sourceSentence: sent,
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// 7. Entities — proper nouns mid-sentence + numeric tokens
//
// Section 88 FIX (2 regex changes):
//   · Proper-noun: accept Title-Case OR all-caps acronyms 2+ letters.
//   · Numeric: drop trailing \b so `%` is preserved in the match.
// -----------------------------------------------------------------------------

const TITLE_CASE = /^[A-Z][a-z]+$/;
const ACRONYM = /^[A-Z]{2,}$/;
const NUMERIC_ENTITY = /\b\d+(?:[.,]\d+)?%?/g;

export function extractEntities(chunks: Chunk[]): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  let id = 0;

  for (const chunk of chunks) {
    const words = chunk.text.split(/\s+/);

    // Proper nouns: capitalised, not at sentence start
    for (let i = 0; i < words.length; i++) {
      const raw = words[i];
      const stripped = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (stripped.length < 3) continue;
      if (!TITLE_CASE.test(stripped) && !ACRONYM.test(stripped)) continue;
      const prev = i > 0 ? words[i - 1] : '';
      if (i === 0) continue;
      if (prev.endsWith('.') || prev.endsWith('?') || prev.endsWith('!')) continue;
      const key = `${chunk.id}:${stripped}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `${chunk.fileId}-e${id++}`,
        fileId: chunk.fileId,
        chunkId: chunk.id,
        text: stripped,
        type: 'proper-noun',
      });
    }

    // Numeric entities — keep `%` in the token
    const nums = chunk.text.match(NUMERIC_ENTITY);
    if (nums) {
      for (const num of nums) {
        const key = `${chunk.id}:num:${num}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: `${chunk.fileId}-e${id++}`,
          fileId: chunk.fileId,
          chunkId: chunk.id,
          text: num,
          type: 'numeric',
        });
      }
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// 8. Orchestrator — ingestFile
// -----------------------------------------------------------------------------

export function ingestFile(input: IngestInput, opts: IngestOptions): IngestResult {
  const type = input.type ?? detectType(input.name, input.mimeType);
  const extracted = extractContent(input, type);
  const cache = opts.cache ?? new Map<string, Int8Array>();
  const maxChunks = opts.maxChunksPerProfile ?? MAX_CHUNKS_PER_PROFILE;
  const existing = opts.existingChunkCount ?? 0;
  const remainingBudget = Math.max(0, maxChunks - existing);

  const candidates: Chunk[] = [];
  let ord = 0;
  for (const page of extracted.pages) {
    const pageChunks = chunkPage(input.fileId, page, ord);
    for (const c of pageChunks) {
      candidates.push(c);
      ord++;
    }
  }

  const chunkCapExceeded = candidates.length > remainingBudget;
  const chunks = candidates.slice(0, remainingBudget);

  const embedStats = embedChunks(chunks, opts.embed, cache);
  const claims = extractClaims(chunks);
  const entities = extractEntities(chunks);
  const uniqueEmbeddingCount = new Set(chunks.map((c) => c.contentHash)).size;
  const vectorSizeBytes = uniqueEmbeddingCount * VECTOR_BYTES;
  const vectorCapExceeded = vectorSizeBytes > MAX_VECTOR_MB * 1024 * 1024;

  const file: IngestedFile = {
    id: input.fileId,
    name: input.name,
    type,
    pageCount: extracted.pages.length,
    chunkCount: chunks.length,
    entityCount: entities.length,
    claimCount: claims.length,
    uniqueEmbeddingCount,
    cacheHits: embedStats.cacheHits,
    cacheMisses: embedStats.cacheMisses,
    vectorSizeBytes,
    capExceeded: chunkCapExceeded || vectorCapExceeded,
  };

  return { file, chunks, entities, claims };
}

// -----------------------------------------------------------------------------
// 9. Quote match against local file text
// -----------------------------------------------------------------------------

export interface QuoteHit {
  fileId: string;
  chunkId: string;
  page: number;
  index: number;
}

export function findQuoteInFile(
  fileId: string,
  quote: string,
  store: { chunks: Chunk[] },
): QuoteHit[] {
  const hits: QuoteHit[] = [];
  const trimmed = quote.trim();
  if (trimmed.length === 0) return hits;
  for (const chunk of store.chunks) {
    if (chunk.fileId !== fileId) continue;
    const idx = chunk.text.indexOf(trimmed);
    if (idx >= 0) {
      hits.push({ fileId, chunkId: chunk.id, page: chunk.page, index: idx });
    }
  }
  return hits;
}
// === FILE END ===