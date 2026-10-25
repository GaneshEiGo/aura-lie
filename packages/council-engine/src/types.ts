// packages/council-engine/src/types.ts
// PRD 7.9 — Council, debate, challenge, second opinion.

export type ModelFamily =
  | 'groq'
  | 'gemini'
  | 'cerebras'
  | 'workers-ai'
  | 'openrouter'
  | 'mistral'
  | 'nvidia'
  | 'github';

export type CouncilRole =
  | 'numbers'    // Yuki — maths, data, estimates
  | 'objections' // Kaito — red team, risks
  | 'momentum'   // Rin — possibilities, energy
  | 'facts'      // Nova — evidence, sources
  | 'synthesis'; // Aura-lie — final synthesis

export interface CouncilSeat {
  role: CouncilRole;
  persona: string;
  family: ModelFamily;
  modelId: string;
}

export type CouncilLabelling = 'real' | 'simulated';

export interface SeatRequest {
  role: CouncilRole;
  persona: string;
  family: ModelFamily;
  modelId: string;
}

export interface AvailableFamily {
  family: ModelFamily;
  modelId: string;
}

/**
 * Result of assembling council seats. Two paths, both explicitly labelled
 * per PRD 7.9:
 *   - real:     at least two distinct model families
 *   - simulated: one family playing every seat
 */
export interface SeatAssembly {
  seats: CouncilSeat[];
  labelling: CouncilLabelling;
  label: string; // "Council: groq, gemini" | "Simulated dissent (single model)"
}

export interface CouncilDissent {
  role: CouncilRole;
  persona: string;
  reason: string;
}

export interface CouncilVerdict {
  proposal: string;
  evidence: string[];
  counterEvidence: string[];
  sourceQuality: string;
  contradictions: string[];
  agreement: number; // 0..1
  synthesis: string;

  // PRD 7.9 anti-theatre rule:
  // "If a council changes nothing (no new risk, no changed claim, no better
  // answer), the run is logged as a no-op and hidden from the user."
  newRisk: boolean;
  changedClaim: boolean;
  betterAnswer: boolean;
}

export interface CouncilResult {
  claimId: string;
  labelling: CouncilLabelling;
  label: string;
  seats: CouncilSeat[];
  verdict: CouncilVerdict;
  dissent: CouncilDissent[];
  isNoOp: boolean;
  hiddenFromUser: boolean;
  reason: string;
}

export interface CouncilBudget {
  estimatedCalls: number; // PRD 7.9: "Cost: at most 12 calls"
  totalPerDay: number;
  remainingPerDay: number;
}

export interface BudgetCheck {
  affordable: boolean;
  requiresConfirm: boolean; // FR-COUNCIL-06: quota < 40%
  estimatedCalls: number;
  reason: string;
}

export interface CentralClaim {
  claimId: string;
  predictedFactScore: number; // 0..100
  importance?: 'central' | 'supporting' | number;
  isCritical?: boolean;
}

export interface AutoCouncilDecision {
  shouldAuto: boolean;
  reason: string;
}

/** PRD 7.9: at most 12 calls for a council run. */
export const COUNCIL_MAX_CALLS = 12;

/** FR-COUNCIL-06: pre-run estimate shown when quota < 40%. */
export const COUNCIL_CONFIRM_THRESHOLD = 0.4;

/** FR-COUNCIL-03: auto-council when predicted fact score < 70 on a critical claim. */
export const AUTO_COUNCIL_SCORE_THRESHOLD = 70;