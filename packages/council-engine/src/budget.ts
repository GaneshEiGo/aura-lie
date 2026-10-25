// packages/council-engine/src/budget.ts
// FR-COUNCIL-06 + PRD 7.9 "Cost: at most 12 calls."
// "The UI shows the expected number of calls before it runs when quota is
// under 40 percent."

import type { BudgetCheck, CouncilBudget } from './types.js';
import {
  COUNCIL_CONFIRM_THRESHOLD,
  COUNCIL_MAX_CALLS,
} from './types.js';

export function checkCouncilBudget(budget: CouncilBudget): BudgetCheck {
  const estimated = Math.min(budget.estimatedCalls, COUNCIL_MAX_CALLS);

  if (budget.remainingPerDay < estimated) {
    return {
      affordable: false,
      requiresConfirm: true,
      estimatedCalls: estimated,
      reason: `Council needs ~${estimated} calls but only ${budget.remainingPerDay} remain today.`,
    };
  }

  const fractionRemaining =
    budget.totalPerDay > 0 ? budget.remainingPerDay / budget.totalPerDay : 1;

  if (fractionRemaining < COUNCIL_CONFIRM_THRESHOLD) {
    return {
      affordable: true,
      requiresConfirm: true,
      estimatedCalls: estimated,
      reason: `Quota is low (${Math.round(fractionRemaining * 100)}% left). Council will use ~${estimated} calls. Confirm before running.`,
    };
  }

  return {
    affordable: true,
    requiresConfirm: false,
    estimatedCalls: estimated,
    reason: `Council will use ~${estimated} calls.`,
  };
}