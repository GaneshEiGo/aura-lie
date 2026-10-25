// === FILE START ===
// packages/truth-score/src/weights.ts
// PRD 8.7 · every constant in one place, versioned, testable.

import type { ClaimVolatility, SourceTier } from './types.js';

/** Bump when any weight below changes. Logged in the changelog. */
export const WEIGHTS_VERSION = '1.0.0';

/** PRD 8.7 factor weights. Renormalised per-claim when factors are missing. */
export const WEIGHTS = {
  S: 0.35,
  E: 0.30,
  A: 0.20,
  F: 0.10,
  C: 0.05,
} as const;

/** PRD 8.7 contradiction penalty. */
export const CONTRADICTION_PENALTY = {
  strong: 15,
  weak: 6,
} as const;

/** PRD 8.7 hard caps — nothing exceeds these. */
export const SCORE_CAPS = {
  /** No source found. */
  noSource: 59,
  /** Any displayed quote failed the string match. */
  quoteFailed: 40,
  /** Only interested-party sources. */
  interestedOnly: 69,
  /** Strong contradiction. */
  strongContradiction: 69,
  /** Time-sensitive claim older than 2 half-lives. */
  stale: 69,
} as const;

/** PRD 8.7 / 8.8 — the three bands that decide the status label. */
export const BANDS = {
  verified: 85,
  supported: 70,
  mixed: 50,
} as const;

/** PRD 8.7 source tier values. best_tier drives the S factor. */
export const SOURCE_TIER_VALUE: Record<SourceTier, number> = {
  primary: 100,
  peerReviewed: 90,
  reputable: 75,
  interested: 50,
  forum: 35,
  unknown: 20,
};

/**
 * PRD 8.7 f(n) — how many independent sources support a claim.
 * 1 source: 0.80. 2 sources: 0.92. 3+: 1.00.
 */
export function sourceCountFactor(n: number): number {
  if (n >= 3) return 1.0;
  if (n === 2) return 0.92;
  if (n === 1) return 0.80;
  return 0;
}

/** PRD 8.7 half-life table. Stable topics never go stale. */
export const HALF_LIFE_DAYS: Record<ClaimVolatility, number> = {
  stable: Infinity,
  slow: 180,
  fast: 2,
};

/**
 * PRD 8.7 freshness formula.
 *   F = 100 if ageDays <= halfLife
 *   F = 100 * 2 / (ageDays / halfLife + 1) otherwise
 *
 * At ageDays = halfLife:   F = 100  (flat inside the first half-life)
 * At ageDays = 2x halfLife: F = 66.7
 * At ageDays = 2.33x:       F = 60   (matches PRD drawer example)
 * At ageDays = 3x halfLife: F = 50
 * At ageDays -> infinity:  F -> 0
 */
export function freshnessScore(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 100;
  if (!Number.isFinite(ageDays) || ageDays <= halfLifeDays) return 100;
  const ratio = ageDays / halfLifeDays;
  return Math.max(0, Math.min(100, (100 * 2) / (ratio + 1)));
}
// === FILE END ===