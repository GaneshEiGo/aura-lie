// === FILE START ===
// packages/truth-score/src/types.ts
// PRD 8.2 · 8.7 · 8.8 · F-035 · F-036.
//
// Every factor name, every status, every cap identifier is a literal type.
// If a future refactor introduces a new factor or status, TypeScript will
// point at every switch that needs updating.

export type SourceTier =
  | 'primary'
  | 'peerReviewed'
  | 'reputable'
  | 'interested'
  | 'forum'
  | 'unknown';

export type ClaimVolatility = 'stable' | 'slow' | 'fast';

export type ClaimImportance = 'central' | 'supporting';

export type ClaimStatus =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CONFLICTED'
  | 'UNVERIFIED'
  | 'RECALL_ONLY'
  | 'NOT_SCORED';

export type Chip =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CHECK'
  | 'PARTIAL'
  | 'RECALL_ONLY';

/** One source, as seen by the scoring pipeline. */
export interface Source {
  tier: SourceTier;
  /** Age of the source in days at scoring time. */
  ageDays: number;
  /**
   * Groups syndicated copies. Two sources with the same independenceKey
   * count as one independent source (PRD 8.7 "syndicated copies count once").
   */
  independenceKey: string;
}

/** Per-factor values. Only present for factors that were computed. */
export interface ScoreFactors {
  S?: number;
  E?: number;
  A?: number;
  F?: number;
  C?: number;
}

export interface ScoreClaimInput {
  /** False for opinion / forecast / fiction. */
  checkable: boolean;
  /** False when retrieval didn't run (quota, tier-0). */
  checked: boolean;
  sources: Source[];
  /**
   * Entailment + quote-match strength: 100 explicit, 70 partial, 30 weak,
   * 0 neutral. Ignored when quoteVerified === false (E becomes 0).
   */
  entailment: number | null;
  /** Judge agreement, 0..100. Null when no judge ran. */
  agreement: number | null;
  /** Consistency with own files/memory, 0..100. Null when nothing to compare. */
  consistency: number | null;
  /**
   * Quote string-match result. `false` triggers the quote-fail cap (40).
   * `null` means no quote was checked (no-source path).
   */
  quoteVerified: boolean | null;
  /** Contradiction evidence, if any. */
  contradiction: 'strong' | 'weak' | null;
  volatility: ClaimVolatility;
  /** Override the default half-life (PRD 8.7 half-life table). */
  halfLifeDays?: number;
}

export interface ScoreResult {
  /** null only for NOT_SCORED and RECALL_ONLY. */
  score: number | null;
  status: ClaimStatus;
  factors: ScoreFactors;
  /** Which hard caps applied. Deterministic order. */
  caps: string[];
  /** Contradiction penalty subtracted from raw. */
  penalty: number;
  /** True when fewer than all 5 factors were computed. */
  partialCheck: boolean;
}

export interface ScoredClaim {
  status: ClaimStatus;
  score: number | null;
  /** Numeric importance: central = 1.0, supporting = 0.5. */
  importance: number;
}

export interface ResponseSummary {
  /** null when no claim could be scored. */
  overall: number | null;
  checkedCount: number;
  checkableCount: number;
  /** 0..1. checkedCount / checkableCount. */
  coverage: number;
  chip: Chip;
  /** PRD 8.7 / L10: true until calibrated on 500 labels. */
  heuristic: true;
}
// === FILE END ===