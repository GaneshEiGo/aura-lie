// packages/stream-proxy/src/budget.ts
// PRD 13.3: "Subrequest budget per request is 50 on the free plan. Standard
// turns use about 20. Think about 30. Deep uses about 35. Anything bigger is
// split into a resumable job (Section 13.7)."

import type { LoopClass, Mode } from './types.js';

/** PRD 13.3: hard cap on subrequests per Worker invocation. */
export const SUBREQUEST_HARD_CAP = 50;

/** PRD 13.3 planning budgets, by loop class. */
export const LOOP_PLANNING_BUDGET: Record<LoopClass, number> = {
  light: 20,
  standard: 20,
  deep: 35,
};

/** Convenience mapping: mode → planning budget. */
export const PLANNING_BUDGET: Record<Mode, number> = {
  instant: 20,
  think: 30,
  research: 35,
  council: 20,
};

export function planningBudgetFor(mode: Mode): number {
  return PLANNING_BUDGET[mode];
}