// === FILE START ===
// packages/library/src/universal-search-v2.ts
// PRD 9.11 · FR-MEM-13 · FR-KNOW-07 · FR-CHAT-06 · PRD 5.15.
//
// Universal search. One `search()` across four sources simultaneously:
//
//   · memory   (weight 1.0 — stable knowledge)
//   · file     (weight 0.9 — the user's own documents)
//   · message  (weight 0.7 — conversation history)
//   · claim    (weight 0.6 — extracted assertions)
//
// Uses BM25 (over the combined corpus) + int8 cosine (over per-doc
// embeddings). Base score is a linear blend; final score multiplies by
// the per-source weight so results from different stores are directly
// comparable.
//
// Section 82.5 FIX (this revision):
//   The dedup step previously collapsed every duplicate `contentKeyOf(text)`
//   to a single hit, regardless of source. That silently dropped legitimate
//   same-source items that happen to share text — e.g. three memory rows
//   with ids `z`, `a`, `m` all containing the literal word "match".
//   The correct semantic is CROSS-SOURCE only:
//     · Single source present in the group → keep every hit (distinct records)
//     · Multiple sources present           → collapse to one hit, primary =
//                                            highest-weight source, `sources`
//                                            array records every source seen
//   The "ties broken by id lexical order" test (which expected all three
//   memories back, sorted a/m/z) is exactly the single-source case.
//
// Returns grouped results — the exact shape PRD 5.15's command bar
// renders when it lists "Project · memory · file · inbox · Track Record".

import { hashText } from './knowledge-ingest-v2.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type SourceKind = 'memory' | 'file' | 'message' | 'claim';

export interface MessageDoc {
  id: string;
  text: string;
  createdAt: number;
  projectId?: string;
  embeddingInt8?: Int8Array;
}

export interface MemoryDoc {
  id: string;
  text: string;
  createdAt: number;
  projectId?: string;
  pinned?: boolean;
  frozen?: boolean;
  sensitivity?: 'S0' | 'S1' | 'S2';
  s2Approved?: boolean;
  embeddingInt8?: Int8Array;
}

export interface FileChunkDoc {
  id: string;
  fileId: string;
  text: string;
  page: number;
  ord: number;
  contentHash: string;
  createdAt: number;
  projectId?: string;
  embeddingInt8?: Int8Array;
}

export interface ClaimDoc {
  id: string;
  text: string;
  status: string;
  score: number | null;
  createdAt: number;
  projectId?: string;
  embeddingInt8?: Int8Array;
}

export interface UniversalSearchStore {
  messages: MessageDoc[];
  memories: MemoryDoc[];
  files: FileChunkDoc[];
  claims: ClaimDoc[];
}

export interface UniversalSearchOptions {
  queryText: string;
  queryEmbedding?: number[];
  store: UniversalSearchStore;
  projectId?: string;
  types?: SourceKind[];
  topK?: number;
  perSourceLimit?: number;
  bm25K1?: number;
  bm25B?: number;
  vectorWeight?: number;
  sourceWeights?: Partial<Record<SourceKind, number>>;
  includeUnapprovedS2?: boolean;
}

export interface UnifiedHit {
  id: string;
  source: SourceKind;
  text: string;
  contentHash: string;
  bm25Score: number;
  vectorScore: number;
  baseScore: number;
  weight: number;
  finalScore: number;
  /** Every source that contained this exact text. Primary source is at [0]. */
  sources: SourceKind[];
  metadata: Record<string, unknown>;
}

export interface UniversalSearchResult {
  memories: UnifiedHit[];
  files: UnifiedHit[];
  messages: UnifiedHit[];
  claims: UnifiedHit[];
  /** Flat topK across all sources (post-dedup). */
  flat: UnifiedHit[];
  filtered: Array<{ id: string; source: SourceKind; reason: string }>;
}

// -----------------------------------------------------------------------------
// Defaults (PRD 9.11 · 5.15)
// -----------------------------------------------------------------------------

export const SOURCE_WEIGHTS: Record<SourceKind, number> = {
  memory: 1.0,
  file: 0.9,
  message: 0.7,
  claim: 0.6,
};

export const DEFAULT_TOP_K = 10;
export const DEFAULT_PER_SOURCE_LIMIT = 5;
export const DEFAULT_VECTOR_WEIGHT = 0.5;
export const EMBEDDING_DIM = 768;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'can', 'could', 'should', 'may', 'might', 'must', 'that', 'this',
  'these', 'those', 'it', 'its', 'and', 'or', 'but', 'not', 'no', 'so', 'up',
  'down', 'out', 'off', 'over', 'under',
]);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Normalise + hash for cross-source dedup. Case- and whitespace-insensitive. */
export function contentKeyOf(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return hashText(norm);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function computeBM25(
  query: string,
  candidates: Array<{ id: string; text: string }>,
  k1: number,
  b: number,
): Map<string, number> {
  const qTokens = tokenize(query);
  const docs = candidates.map((c) => ({ id: c.id, tokens: tokenize(c.text) }));
  const total = docs.length;
  if (total === 0 || qTokens.length === 0) {
    return new Map(candidates.map((c) => [c.id, 0]));
  }
  const avgLen =
    docs.reduce((s, d) => s + d.tokens.length, 0) / total || 1;

  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log(1 + (total - freq + 0.5) / (freq + 0.5)));
  }

  const scores = new Map<string, number>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qTokens) {
      const freq = tf.get(qt) ?? 0;
      if (freq === 0) continue;
      const idfVal = idf.get(qt) ?? 0;
      const denom = freq + k1 * (1 - b + (b * d.tokens.length) / avgLen);
      score += (idfVal * freq * (k1 + 1)) / denom;
    }
    scores.set(d.id, score);
  }
  return scores;
}

export function quantizeInt8(vec: number[]): Int8Array {
  const out = new Int8Array(EMBEDDING_DIM);
  const n = Math.min(vec.length, EMBEDDING_DIM);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, vec[i]));
    out[i] = Math.round(v * 127);
  }
  return out;
}

export function cosineInt8(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// -----------------------------------------------------------------------------
// universalSearch — the entry point
// -----------------------------------------------------------------------------

interface Candidate {
  source: SourceKind;
  id: string;
  text: string;
  embeddingInt8?: Int8Array;
  metadata: Record<string, unknown>;
}

export function universalSearch(opts: UniversalSearchOptions): UniversalSearchResult {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const perSourceLimit = opts.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT;
  const k1 = opts.bm25K1 ?? 1.2;
  const b = opts.bm25B ?? 0.75;
  const vectorWeight = opts.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const weights: Record<SourceKind, number> = {
    ...SOURCE_WEIGHTS,
    ...(opts.sourceWeights ?? {}),
  };
  const types: SourceKind[] =
    opts.types && opts.types.length > 0
      ? opts.types
      : ['memory', 'file', 'message', 'claim'];

  const filtered: Array<{ id: string; source: SourceKind; reason: string }> = [];
  const candidates: Candidate[] = [];

  // 1. Filter + collect
  if (types.includes('memory')) {
    for (const m of opts.store.memories) {
      if (m.frozen) {
        filtered.push({ id: m.id, source: 'memory', reason: 'frozen' });
        continue;
      }
      if (
        m.sensitivity === 'S2' &&
        !m.s2Approved &&
        !opts.includeUnapprovedS2
      ) {
        filtered.push({ id: m.id, source: 'memory', reason: 'unapproved S2' });
        continue;
      }
      if (opts.projectId && m.projectId && m.projectId !== opts.projectId) {
        filtered.push({ id: m.id, source: 'memory', reason: 'project mismatch' });
        continue;
      }
      candidates.push({
        source: 'memory',
        id: m.id,
        text: m.text,
        embeddingInt8: m.embeddingInt8,
        metadata: {
          createdAt: m.createdAt,
          projectId: m.projectId,
          pinned: m.pinned,
        },
      });
    }
  }

  if (types.includes('file')) {
    for (const f of opts.store.files) {
      if (opts.projectId && f.projectId && f.projectId !== opts.projectId) {
        filtered.push({ id: f.id, source: 'file', reason: 'project mismatch' });
        continue;
      }
      candidates.push({
        source: 'file',
        id: f.id,
        text: f.text,
        embeddingInt8: f.embeddingInt8,
        metadata: {
          fileId: f.fileId,
          page: f.page,
          ord: f.ord,
          contentHash: f.contentHash,
          createdAt: f.createdAt,
          projectId: f.projectId,
        },
      });
    }
  }

  if (types.includes('message')) {
    for (const m of opts.store.messages) {
      if (opts.projectId && m.projectId && m.projectId !== opts.projectId) {
        filtered.push({ id: m.id, source: 'message', reason: 'project mismatch' });
        continue;
      }
      candidates.push({
        source: 'message',
        id: m.id,
        text: m.text,
        embeddingInt8: m.embeddingInt8,
        metadata: { createdAt: m.createdAt, projectId: m.projectId },
      });
    }
  }

  if (types.includes('claim')) {
    for (const c of opts.store.claims) {
      if (opts.projectId && c.projectId && c.projectId !== opts.projectId) {
        filtered.push({ id: c.id, source: 'claim', reason: 'project mismatch' });
        continue;
      }
      candidates.push({
        source: 'claim',
        id: c.id,
        text: c.text,
        embeddingInt8: c.embeddingInt8,
        metadata: {
          status: c.status,
          score: c.score,
          createdAt: c.createdAt,
          projectId: c.projectId,
        },
      });
    }
  }

  if (candidates.length === 0) {
    return {
      memories: [],
      files: [],
      messages: [],
      claims: [],
      flat: [],
      filtered,
    };
  }

  // 2. BM25 over combined corpus
  const bm25Scores = computeBM25(opts.queryText, candidates, k1, b);

  // 3. Vector query
  const queryInt8 = opts.queryEmbedding ? quantizeInt8(opts.queryEmbedding) : null;

  // 4. Score per candidate
  interface ScoredCandidate extends Candidate {
    bm25: number;
    vector: number;
    baseScore: number;
    finalScore: number;
    contentKey: string;
  }

  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const bm25 = bm25Scores.get(c.id) ?? 0;
    const vector =
      queryInt8 && c.embeddingInt8 ? cosineInt8(queryInt8, c.embeddingInt8) : 0;
    const baseScore = bm25 * (1 - vectorWeight) + vector * vectorWeight;
    if (baseScore === 0) continue; // no match at all — do not return
    const w = weights[c.source];
    scored.push({
      ...c,
      bm25,
      vector,
      baseScore,
      finalScore: baseScore * w,
      contentKey: contentKeyOf(c.text),
    });
  }

  if (scored.length === 0) {
    return {
      memories: [],
      files: [],
      messages: [],
      claims: [],
      flat: [],
      filtered,
    };
  }

  // 5. Dedup by contentKey — CROSS-SOURCE ONLY (Section 82.5 fix)
  //
  //   · Group by contentKey (normalised text).
  //   · Sub-group by source kind.
  //   · If the group contains exactly ONE source kind → keep every hit from
  //     that source. Same-source duplicates are distinct records (three
  //     memory rows with the literal text "match", for example) and must all
  //     be preserved. This is what the "ties broken by id lexical order"
  //     test verifies.
  //   · If the group spans TWO OR MORE source kinds → collapse to one hit.
  //     The primary source is the highest-weight one (memory > file > message
  //     > claim). The `sources` array records every source that contained
  //     this text, sorted by weight descending.
  interface Merged extends ScoredCandidate {
    sources: SourceKind[];
  }

  const byKey = new Map<string, ScoredCandidate[]>();
  for (const s of scored) {
    const arr = byKey.get(s.contentKey) ?? [];
    arr.push(s);
    byKey.set(s.contentKey, arr);
  }

  const merged: Merged[] = [];
  for (const [, group] of byKey.entries()) {
    // Sub-group by source kind.
    const bySource = new Map<SourceKind, ScoredCandidate[]>();
    for (const g of group) {
      const arr = bySource.get(g.source) ?? [];
      arr.push(g);
      bySource.set(g.source, arr);
    }

    if (bySource.size === 1) {
      // Single source — keep EVERY hit from that source.
      // This is the "ties" case: three memories, identical text, different ids.
      for (const [, items] of bySource) {
        for (const item of items) {
          merged.push({ ...item, sources: [item.source] });
        }
      }
    } else {
      // Multiple sources — collapse to one hit.
      group.sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      const winner = group[0];
      const sources: SourceKind[] = [];
      for (const g of group) {
        if (!sources.includes(g.source)) sources.push(g.source);
      }
      // Primary = highest-weight source
      sources.sort((a, b) => weights[b] - weights[a]);
      merged.push({ ...winner, source: sources[0], sources });
    }
  }

  // 6. Sort merged — deterministic: score DESC, id ASC
  merged.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // 7. Unified hits
  const toHit = (s: Merged): UnifiedHit => ({
    id: s.id,
    source: s.source,
    text: s.text,
    contentHash: s.contentKey,
    bm25Score: s.bm25,
    vectorScore: s.vector,
    baseScore: s.baseScore,
    weight: weights[s.source],
    finalScore: s.finalScore,
    sources: s.sources,
    metadata: s.metadata,
  });

  const allHits = merged.map(toHit);

  // 8. Group
  return {
    memories: allHits.filter((h) => h.source === 'memory').slice(0, perSourceLimit),
    files: allHits.filter((h) => h.source === 'file').slice(0, perSourceLimit),
    messages: allHits.filter((h) => h.source === 'message').slice(0, perSourceLimit),
    claims: allHits.filter((h) => h.source === 'claim').slice(0, perSourceLimit),
    flat: allHits.slice(0, topK),
    filtered,
  };
}
// === FILE END ===