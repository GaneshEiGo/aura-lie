// === FILE START ===
// packages/truth-score/src/score.ts
// PRD 8.7 · F-035 · F-036 · FR-TRUTH-06 · FR-TRUTH-07.

import type { ScoreClaimInput, ScoreFactors, ScoreResult, ClaimStatus, Source } from './types.js';
import {
  BANDS,
  CONTRADICTION_PENALTY,
  HALF_LIFE_DAYS,
  SCORE_CAPS,
  SOURCE_TIER_VALUE,
  WEIGHTS,
  freshnessScore,
  sourceCountFactor,
} from './weights.js';

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

/** Deduplicate sources by independenceKey — PRD 8.7 "syndicated copies count once". */
function dedupeIndependent(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (seen.has(s.independenceKey)) continue;
    seen.add(s.independenceKey);
    out.push(s);
  }
  return out;
}

export function scoreClaim(input: ScoreClaimInput): ScoreResult {
  // 1. Not checkable → NOT_SCORED
  if (!input.checkable) {
    return {
      score: null,
      status: 'NOT_SCORED',
      factors: {},
      caps: ['not_checkable'],
      penalty: 0,
      partialCheck: false,
    };
  }

  // 2. Not checked → RECALL_ONLY
  if (!input.checked) {
    return {
      score: null,
      status: 'RECALL_ONLY',
      factors: {},
      caps: ['not_checked'],
      penalty: 0,
      partialCheck: false,
    };
  }

  const factors: ScoreFactors = {};
  const caps: string[] = [];
  const independent = dedupeIndependent(input.sources);
  const quoteFailed = input.quoteVerified === false;

  // S — source support
  if (independent.length === 0) {
    caps.push('no_source');
  } else {
    const bestTierValue = Math.max(
      ...independent.map((s) => SOURCE_TIER_VALUE[s.tier]),
    );
    const n = independent.length;
    factors.S = bestTierValue * sourceCountFactor(n);
    if (independent.every((s) => s.tier === 'interested')) {
      caps.push('interested_only');
    }
  }

  // E — entailment + quote match
  if (quoteFailed) {
    factors.E = 0;
    caps.push('quote_failed');
  } else if (input.entailment !== null) {
    factors.E = clamp(input.entailment, 0, 100);
  }

  // A — judge agreement
  if (input.agreement !== null) {
    factors.A = clamp(input.agreement, 0, 100);
  }

  // F — freshness
  if (independent.length > 0) {
    const halfLife = input.halfLifeDays ?? HALF_LIFE_DAYS[input.volatility];
    const totalAge = independent.reduce((sum, s) => sum + Math.max(0, s.ageDays), 0);
    const avgAge = totalAge / independent.length;
    if (halfLife === Infinity) {
      factors.F = 100;
    } else {
      factors.F = freshnessScore(avgAge, halfLife);
      if (avgAge > 2 * halfLife) {
        caps.push('stale');
      }
    }
  }

  // C — consistency
  if (input.consistency !== null) {
    factors.C = clamp(input.consistency, 0, 100);
  }

  // Compute raw with renormalised weights
  const present: Array<[keyof ScoreFactors, number]> = [];
  if (factors.S !== undefined) present.push(['S', WEIGHTS.S]);
  if (factors.E !== undefined) present.push(['E', WEIGHTS.E]);
  if (factors.A !== undefined) present.push(['A', WEIGHTS.A]);
  if (factors.F !== undefined) present.push(['F', WEIGHTS.F]);
  if (factors.C !== undefined) present.push(['C', WEIGHTS.C]);

  const totalWeight = present.reduce((sum, [, w]) => sum + w, 0);
  const partialCheck = present.length < 5;

  let raw = 0;
  if (totalWeight > 0) {
    let weighted = 0;
    for (const [k, w] of present) {
      weighted += (factors[k] as number) * w;
    }
    raw = weighted / totalWeight;
  }

  // Contradiction penalty
  let penalty = 0;
  if (input.contradiction === 'strong') {
    penalty = CONTRADICTION_PENALTY.strong;
    caps.push('strong_contradiction');
  } else if (input.contradiction === 'weak') {
    penalty = CONTRADICTION_PENALTY.weak;
  }

  let score = raw - penalty;

  // Caps (min of all that apply)
  if (caps.includes('quote_failed')) score = Math.min(score, SCORE_CAPS.quoteFailed);
  if (caps.includes('no_source')) score = Math.min(score, SCORE_CAPS.noSource);
  if (caps.includes('interested_only')) score = Math.min(score, SCORE_CAPS.interestedOnly);
  if (caps.includes('strong_contradiction')) score = Math.min(score, SCORE_CAPS.strongContradiction);
  if (caps.includes('stale')) score = Math.min(score, SCORE_CAPS.stale);

  score = Math.round(clamp(score, 0, 100));

  // Status
  let status: ClaimStatus;
  if (caps.includes('strong_contradiction')) {
    status = 'CONFLICTED';
  } else if (caps.includes('quote_failed') || caps.includes('no_source')) {
    status = 'UNVERIFIED';
  } else if (score >= BANDS.verified) {
    status = 'VERIFIED';
  } else if (score >= BANDS.supported) {
    status = 'SUPPORTED';
  } else if (score >= BANDS.mixed) {
    status = 'MIXED';
  } else {
    status = 'WEAK';
  }

  return { score, status, factors, caps, penalty, partialCheck };
}
// === FILE END ===