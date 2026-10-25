// packages/council-engine/src/auto.ts
// FR-COUNCIL-03: "Auto-council when predicted Fact Score < 70 on a
// high-importance claim."

import type { AutoCouncilDecision, CentralClaim } from './types.js';
import { AUTO_COUNCIL_SCORE_THRESHOLD } from './types.js';

export function shouldAutoCouncil(claim: CentralClaim): AutoCouncilDecision {
  const isCritical = isCriticalClaim(claim);
  const lowScore = claim.predictedFactScore < AUTO_COUNCIL_SCORE_THRESHOLD;

  if (!isCritical) {
    return {
      shouldAuto: false,
      reason: 'Claim is not critical; council reserved for high-importance claims.',
    };
  }
  if (!lowScore) {
    return {
      shouldAuto: false,
      reason: `Predicted score ${claim.predictedFactScore} ≥ ${AUTO_COUNCIL_SCORE_THRESHOLD}; no auto-council needed.`,
    };
  }
  return {
    shouldAuto: true,
    reason: `Critical claim scored ${claim.predictedFactScore} < ${AUTO_COUNCIL_SCORE_THRESHOLD}; auto-council triggered.`,
  };
}

function isCriticalClaim(claim: CentralClaim): boolean {
  if (claim.isCritical === true) return true;
  const imp = claim.importance;
  if (imp === 'central') return true;
  if (typeof imp === 'number' && imp >= 0.7) return true;
  return false;
}