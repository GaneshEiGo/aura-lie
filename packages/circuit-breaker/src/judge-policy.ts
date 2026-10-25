// packages/circuit-breaker/src/judge-policy.ts
// FR-TRUTH-05: "The entailment judge is always a different model family
// from the drafter." PRD 7.4 diversity_bonus: "judges and critics prefer
// a different model family from the generator."

import type { Candidate, ModelFamily } from './types.js';

export function drafterFamilies(drafters: Candidate[]): ModelFamily[] {
  return Array.from(new Set(drafters.map((d) => d.family)));
}

export function excludeDrafterFamilies(
  candidates: Candidate[],
  drafterFamilies: ModelFamily[],
): Candidate[] {
  const excluded = new Set(drafterFamilies);
  return candidates.filter((c) => !excluded.has(c.family));
}

/**
 * Sorts candidates so families that differ from the generator come first.
 * This is the PRD 7.4 "diversity_bonus" for the router's soft scoring.
 */
export function sortByDiversity(
  candidates: Candidate[],
  generatorFamily: ModelFamily,
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aDiverse = a.family !== generatorFamily ? 1 : 0;
    const bDiverse = b.family !== generatorFamily ? 1 : 0;
    if (aDiverse !== bDiverse) return bDiverse - aDiverse;
    return 0;
  });
}