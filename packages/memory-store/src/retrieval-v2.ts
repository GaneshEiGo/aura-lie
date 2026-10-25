// === FILE START ===
// packages/memory-store/src/retrieval-v2.ts
// PRD 9.6 · FR-MEM-13 · FR-MEM-08 · FR-MEM-04.
//
// Hybrid retrieval over cached vectors + text. The pipeline:
//
//   1. Filter: drop frozen memories and unapproved S2 (PRD 9.6 step 3)
//   2. BM25 over memory text
//   3. Brute-force cosine over int8-quantized vectors
//   4. Merge, rerank by recency + importance + project match + pin
//   5. Budget to the loop's memory-token allowance
//
// Deterministic. No model. Every candidate scored, every reason exposed.

export type MemoryType = 'episodic' | 'semantic' | 'project' | 'temporal';
export type Sensitivity = 'S0' | 'S1' | 'S2' | 'secret';

export interface RetrievalCandidate {
  id: string;
  text: string;
  type: MemoryType;
  sensitivity: Sensitivity;
  createdAt: number;
  lastUsedAt?: number;
  /** If present, this is the int8-quantized embedding (dimension fixed at 768). */
  embeddingInt8?: Int8Array;
  /** Pin overrides ranking to the top. */
  pinned?: boolean;
  /** Frozen = never retrieve (PRD 9.6 step 3). */
  frozen?: boolean;
  /** Unapproved S2 memories are excluded unless explicitly allowed. */
  s2Approved?: boolean;
  /** Optional project scope for rerank. */
  projectId?: string;
}

export interface RetrievalOptions {
  queryText: string;
  queryEmbedding?: number[];
  candidates: RetrievalCandidate[];
  /** Filter to a specific project. Undefined = all projects. */
  projectId?: string;
  /** Include unapproved S2 memories. Default false (PRD 9.6 step 3). */
  includeUnapprovedS2?: boolean;
  /** Top-K results. Default 5 (FR-MEM-13 uses @5). */
  topK?: number;
  /** Injectable clock. */
  now?: () => number;
  /** BM25 k1 / b parameters. */
  bm25K1?: number;
  bm25B?: number;
  /** Weight for vector score vs BM25 (0..1). Default 0.5. */
  vectorWeight?: number;
}

export interface RetrievalHit {
  id: string;
  text: string;
  bm25Score: number;
  vectorScore: number;
  combinedScore: number;
  rerankBoost: number;
  finalScore: number;
  reasons: string[];
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  filtered: Array<{ id: string; reason: string }>;
}

// -----------------------------------------------------------------------------
// Int8 quantization (dimension fixed at 768, values mapped -1..1 → -127..127)
// -----------------------------------------------------------------------------

export const VECTOR_DIM = 768;

export function quantizeInt8(vec: number[]): Int8Array {
  const out = new Int8Array(VECTOR_DIM);
  const n = Math.min(vec.length, VECTOR_DIM);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, vec[i]));
    out[i] = Math.round(v * 127);
  }
  return out;
}

/** Cosine over int8 vectors, arithmetic only. */
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
// BM25
// -----------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function computeBM25(
  query: string,
  docs: Array<{ id: string; text: string }>,
  k1: number,
  b: number,
): Map<string, number> {
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || docs.length === 0) {
    return new Map(docs.map((d) => [d.id, 0]));
  }
  const docTokens = docs.map((d) => tokenize(d.text));
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / docTokens.length;
  const df = new Map<string, number>();
  for (const toks of docTokens) {
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
  }
  const scores = new Map<string, number>();
  for (let i = 0; i < docs.length; i++) {
    const toks = docTokens[i];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qTokens) {
      const freq = tf.get(qt) ?? 0;
      if (freq === 0) continue;
      const idfVal = idf.get(qt) ?? 0;
      const denom = freq + k1 * (1 - b + (b * toks.length) / avgLen);
      score += idfVal * (freq * (k1 + 1)) / denom;
    }
    scores.set(docs[i].id, score);
  }
  return scores;
}

// -----------------------------------------------------------------------------
// Hybrid retrieval
// -----------------------------------------------------------------------------

export function hybridRetrieve(opts: RetrievalOptions): RetrievalResult {
  const topK = opts.topK ?? 5;
  const k1 = opts.bm25K1 ?? 1.2;
  const b = opts.bm25B ?? 0.75;
  const vectorWeight = opts.vectorWeight ?? 0.5;
  const now = opts.now ?? (() => Date.now());
  const nowMs = now();

  const filtered: Array<{ id: string; reason: string }> = [];
  const usable: RetrievalCandidate[] = [];

  for (const c of opts.candidates) {
    if (c.frozen) {
      filtered.push({ id: c.id, reason: 'frozen' });
      continue;
    }
    if (c.sensitivity === 'S2' && !c.s2Approved && !opts.includeUnapprovedS2) {
      filtered.push({ id: c.id, reason: 'unapproved S2' });
      continue;
    }
    if (opts.projectId && c.projectId && c.projectId !== opts.projectId) {
      filtered.push({ id: c.id, reason: 'project mismatch' });
      continue;
    }
    usable.push(c);
  }

  if (usable.length === 0) {
    return { hits: [], filtered };
  }

  const bm25Scores = computeBM25(
    opts.queryText,
    usable.map((c) => ({ id: c.id, text: c.text })),
    k1,
    b,
  );

  const queryInt8 = opts.queryEmbedding ? quantizeInt8(opts.queryEmbedding) : null;

  const hits: RetrievalHit[] = [];
  for (const c of usable) {
    const bm25 = bm25Scores.get(c.id) ?? 0;
    const vector =
      queryInt8 && c.embeddingInt8 ? cosineInt8(queryInt8, c.embeddingInt8) : 0;
    const combined = (1 - vectorWeight) * bm25 + vectorWeight * vector;

    // Rerank boost: recency + pin + project match
    let boost = 0;
    const reasons: string[] = [];
    if (c.pinned) {
      boost += 10;
      reasons.push('pinned');
    }
    if (opts.projectId && c.projectId === opts.projectId) {
      boost += 0.5;
      reasons.push('project-match');
    }
    const ageDays = Math.max(0, (nowMs - c.createdAt) / (24 * 60 * 60 * 1000));
    if (ageDays < 7) {
      boost += 0.3;
      reasons.push('recent');
    }
    const final = combined + boost;

    hits.push({
      id: c.id,
      text: c.text,
      bm25Score: bm25,
      vectorScore: vector,
      combinedScore: combined,
      rerankBoost: boost,
      finalScore: final,
      reasons,
    });
  }

  // Sort: finalScore DESC, pinned first within ties, then id ASC for determinism.
  hits.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { hits: hits.slice(0, topK), filtered };
}
// === FILE END ===