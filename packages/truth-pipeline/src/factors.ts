// packages/truth-pipeline/src/factors.ts
// PRD 8.7 per-claim factor computation (S, E, A, F).

import type { ExtractedClaim, JudgeVerdict, VerifiedSource } from './types.js';

export interface ComputedFactors {
  S: number;
  E: number;
  A: number;
  F: number;
}

export function computeFactors(input: {
  claim: ExtractedClaim;
  sources: VerifiedSource[];
  stances: JudgeVerdict[];
}): ComputedFactors {
  if (input.sources.length === 0) {
    return { S: 0, E: 0, A: 0, F: 0 };
  }

  // --- S = best tier × f(n) (PRD 8.7) ---
  const bestTier = Math.max(...input.sources.map((s) => s.tier));
  const independentGroups = new Set(
    input.sources.map((s) => s.independenceGroup),
  ).size;
  const fn = independentGroups >= 3 ? 1.0 : independentGroups === 2 ? 0.92 : 0.80;
  const S = bestTier * fn;

  // --- E = entailment from the strongest verified stance ---
  const anyQuoteMatched = input.sources.some((s) => s.matchOk);
  const supports = input.stances.filter((s) => s.stance === 'supports').length;
  const contradicts = input.stances.filter((s) => s.stance === 'contradicts').length;

  let E = 0;
  if (supports > 0 && anyQuoteMatched) E = 100;
  else if (anyQuoteMatched && contradicts === 0) E = 70;
  else if (anyQuoteMatched) E = 30;

  // --- A = share of judges that support (0..100) ---
  const A =
    input.stances.length > 0 ? (supports / input.stances.length) * 100 : 0;

  // --- F = freshness (W1 heuristic; W3 will use real half-lives) ---
  const F = input.claim.volatility === 'fast' ? 90 : 100;

  return { S, E, A, F };
}