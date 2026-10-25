// packages/council-engine/src/engine.ts
// The Council Engine, PRD 7.9.
//
// This module is the pure decision layer. The real orchestrator
// (packages/agents in a later section) feeds actual model responses
// into `finalizeCouncilRun`. The engine itself guarantees:
//   - Labelling rules (real vs simulated) via buildSeats
//   - Cost-aware budgeting via checkCouncilBudget
//   - Auto-council trigger via shouldAutoCouncil
//   - Anti-theatre no-op rule via finalizeCouncilRun
//   - Evidence-ranked synthesis via renderSynthesis
//
// It never calls a model directly. That is the orchestrator's job.

export {
  buildSeats,
  makeLabelling,
} from './seats.js';

export {
  checkCouncilBudget,
} from './budget.js';

export {
  shouldAutoCouncil,
} from './auto.js';

export {
  finalizeCouncilRun,
  renderSynthesis,
} from './synthesis.js';

export * from './types.js';