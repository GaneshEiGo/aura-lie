import type { ScoreFactors, ClaimStatus } from './types.js';

/**
 * PRD Section 8.7: Scoring
 * Heuristic, transparent and tunable.
 */
export class ScoreEngine {
  public calculateScore(factors: ScoreFactors): { score: number, status: ClaimStatus } {
    const { baseTier, sourceCount, entailment, agreement, freshness, contradictionPenalty } = factors;

    // f(n): 1 source = 0.80, 2 sources = 0.92, 3+ = 1.00
    let f_n = 0.80;
    if (sourceCount >= 3) f_n = 1.00;
    else if (sourceCount === 2) f_n = 0.92;

    // S: source support
    const S = baseTier * f_n;
    // E: entailment and quote match
    const E = entailment;
    // A: judge agreement
    const A = agreement;
    // F: freshness
    const F = freshness;
    // C: consistency (default 0 for now, excluded if not computed)
    const C = 0;

    // Raw formula from PRD
    const raw = (0.35 * S) + (0.30 * E) + (0.20 * A) + (0.10 * F) + (0.05 * C);
    
    // Clamp 0-100 and apply penalty
    let finalScore = Math.max(0, Math.min(100, raw - contradictionPenalty));

    // Hard Caps & Floors (FR-TRUTH-07)
    if (entailment === 0 || sourceCount === 0) {
      finalScore = Math.min(finalScore, 59);
    }
    if (contradictionPenalty > 0) {
      finalScore = Math.min(finalScore, 69);
    }

    // Determine Status
    let status: ClaimStatus = 'UNVERIFIED';
    if (contradictionPenalty >= 15) status = 'CONFLICTED';
    else if (finalScore >= 85) status = 'VERIFIED';
    else if (finalScore >= 70) status = 'SUPPORTED';
    else if (finalScore >= 50) status = 'MIXED';
    else status = 'WEAK';

    return { score: Math.round(finalScore), status };
  }
}