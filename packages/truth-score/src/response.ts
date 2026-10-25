// === FILE START ===
// packages/truth-score/src/response.ts
// PRD 8.7 response-level rule · F-035 · Chip determination.
//
// Section 74.1 fix:
//   The empty-claims branch used `coverage === 0` to select RECALL_ONLY.
//   But `coverage` is VACUOUSLY 1 for an empty set (0/0 → the ternary's
//   `checkable.length === 0 ? 1 : …` guard fires), so `scoreResponse([])`
//   returned 'PARTIAL'. PRD 5.6 says empty coverage → RECALL_ONLY.
//   Fix: use `checked.length === 0` as the discriminator. That is the
//   correct semantic test — "no claims were actually checked" — and it
//   covers both empty input and all-RECALL_ONLY input.

import type { Chip, ResponseSummary, ScoredClaim } from './types.js';
import { BANDS } from './weights.js';

export function scoreResponse(claims: ScoredClaim[]): ResponseSummary {
  const checkable = claims.filter((c) => c.status !== 'NOT_SCORED');
  const checked = checkable.filter((c) => c.status !== 'RECALL_ONLY');
  const scored = checked.filter((c) => c.score !== null);

  const coverage =
    checkable.length === 0 ? 1 : checked.length / checkable.length;

  if (scored.length === 0) {
    // Section 74.1 fix: `checked.length === 0` is the correct empty-case
    // discriminator. An empty claims array (and an all-RECALL_ONLY array)
    // both have checked.length === 0 → RECALL_ONLY. A non-empty array where
    // every checked claim has a null score is the only path to PARTIAL here,
    // and that path only fires if `checked.length > 0` but no scores exist.
    return {
      overall: null,
      checkedCount: checked.length,
      checkableCount: checkable.length,
      coverage,
      chip: checked.length === 0 ? 'RECALL_ONLY' : 'PARTIAL',
      heuristic: true,
    };
  }

  const totalWeight = scored.reduce((s, c) => s + c.importance, 0);
  const weightedSum = scored.reduce(
    (s, c) => s + c.importance * (c.score as number),
    0,
  );
  const mean = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const criticals = scored
    .filter((c) => c.importance >= 0.7)
    .map((c) => c.score as number);
  const lowestCritical = criticals.length > 0 ? Math.min(...criticals) : Infinity;
  const weakestBound =
    lowestCritical === Infinity ? Infinity : lowestCritical + 15;

  const overall = Math.round(Math.min(mean, weakestBound));

  // Chip priority (PRD 5.6): CHECK > PARTIAL > VERIFIED > SUPPORTED > MIXED > WEAK
  const anyCriticalConflicted = scored.some(
    (c) => c.status === 'CONFLICTED' && c.importance >= 0.7,
  );

  let chip: Chip;
  if (coverage === 0) chip = 'RECALL_ONLY';
  else if (anyCriticalConflicted) chip = 'CHECK';
  else if (coverage < 0.5) chip = 'PARTIAL';
  else if (overall >= BANDS.verified) chip = 'VERIFIED';
  else if (overall >= BANDS.supported) chip = 'SUPPORTED';
  else if (overall >= BANDS.mixed) chip = 'MIXED';
  else chip = 'WEAK';

  return {
    overall,
    checkedCount: checked.length,
    checkableCount: checkable.length,
    coverage,
    chip,
    heuristic: true,
  };
}
// === FILE END ===