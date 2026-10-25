import type { ClaimForScoring, ScoredClaim } from './types.js';
import { scoreClaim } from './score.js';

export interface ResponseSummary {
  overall: number | null;
  checked: number;
  checkable: number;
  chip: 'VERIFIED' | 'SUPPORTED' | 'MIXED' | 'WEAK' | 'CHECK' | 'PARTIAL' | 'RECALL-ONLY';
  heuristic: boolean;
  claims: ScoredClaim[];
}

/**
 * PRD §8.7: Response-level summary (no single magic number).
 * overall = min(weighted_mean, lowest_critical_score + 15)
 */
export function summarizeResponse(claims: ClaimForScoring[], checkableCount: number): ResponseSummary {
  if (claims.length === 0) {
    return { overall: null, checked: 0, checkable: checkableCount, chip: 'RECALL-ONLY', heuristic: true, claims: [] };
  }

  const scoredClaims = claims.map(scoreClaim);
  
  // 1. Calculate weighted mean
  let weightedSum = 0;
  let importanceSum = 0;
  let lowestCriticalScore = 100;
  let hasCritical = false;

  for (const claim of claims) {
    const scored = scoredClaims.find(c => c.id === claim.id)!;
    const score = scored.score || 0;

    weightedSum += score * claim.importance;
    importanceSum += claim.importance;

    // Critical importance is >= 0.7
    if (claim.importance >= 0.7) {
      hasCritical = true;
      if (score < lowestCriticalScore) {
        lowestCriticalScore = score;
      }
    }
  }

  const mean = importanceSum > 0 ? weightedSum / importanceSum : 0;
  
  // 2. Weakest critical link rule
  let overall = mean;
  if (hasCritical) {
    overall = Math.min(mean, lowestCriticalScore + 15);
  }
  overall = Math.round(overall);

  // 3. Determine chip
  let chip: ResponseSummary['chip'] = 'MIXED';
  const anyConflicted = scoredClaims.some(c => c.status === 'CONFLICTED');
  
  if (anyConflicted) {
    chip = 'CHECK';
  } else if (claims.length < checkableCount) {
    chip = 'PARTIAL';
  } else if (overall >= 85) {
    chip = 'VERIFIED';
  } else if (overall >= 70) {
    chip = 'SUPPORTED';
  } else if (overall >= 50) {
    chip = 'MIXED';
  } else {
    chip = 'WEAK';
  }

  return {
    overall,
    checked: claims.length,
    checkable: checkableCount,
    chip,
    heuristic: true,
    claims: scoredClaims
  };
}