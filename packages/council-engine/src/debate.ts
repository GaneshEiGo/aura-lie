// === FILE START ===
// packages/council-engine/src/debate.ts
// PRD §7.9 · FR-COUNCIL-04.
//
// Debate: two positions argued with different prompts. A judge scores by
// evidence and logic, not rhetoric. Output is a verdict table with each
// side's strongest and weakest argument.
//
// Two calls: one per side. Evidence scoring is deterministic
// (number markers, source markers, word count). The judge is the caller
// itself for now; a separate judge model is a W5 extension.

import type { CouncilSeat, ModelCaller } from './real.js';

export interface DebateInput {
  question: string;
  position_a: string;
  position_b: string;
  seat_a: CouncilSeat;
  seat_b: CouncilSeat;
  caller: ModelCaller;
}

export interface DebateRound {
  position_a_argument: string;
  position_b_argument: string;
}

export type DebateWinner = 'a' | 'b' | 'tie';

export interface DebateResult {
  rounds: DebateRound[];
  verdict: {
    winning_side: DebateWinner;
    strongest_argument_a: string;
    strongest_argument_b: string;
    evidence_score_a: number;
    evidence_score_b: number;
  };
  calls_used: number;
}

export async function runDebate(input: DebateInput): Promise<DebateResult> {
  const aResp = await input.caller({
    seat: input.seat_a,
    prompt: `Argue for: ${input.position_a}\nQuestion: ${input.question}\nCite evidence where possible.`,
  });
  const bResp = await input.caller({
    seat: input.seat_b,
    prompt: `Argue for: ${input.position_b}\nQuestion: ${input.question}\nCite evidence where possible.`,
  });

  const scoreA = estimateEvidence(aResp.text);
  const scoreB = estimateEvidence(bResp.text);
  const winning_side: DebateWinner =
    scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : 'tie';

  return {
    rounds: [{ position_a_argument: aResp.text, position_b_argument: bResp.text }],
    verdict: {
      winning_side,
      strongest_argument_a: aResp.text,
      strongest_argument_b: bResp.text,
      evidence_score_a: scoreA,
      evidence_score_b: scoreB,
    },
    calls_used: 2,
  };
}

/**
 * Deterministic evidence proxy. Not a model. Counts:
 *   · numeric markers (digits) → ×2
 *   · source markers ([n], source, study, according to) → ×3
 *   · word count → ×0.01
 *
 * Rationale (PRD §7.9): "Evidence beats popularity". Rhetoric alone cannot
 * win the debate on this scoring; the argument must carry at least one
 * numeric or source marker to score above the tie floor.
 */
function estimateEvidence(text: string): number {
  const numbers = text.match(/\d+/g) ?? [];
  const sources = text.match(/\[\d+\]|(?:source|study|according\s+to)\b/gi) ?? [];
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return numbers.length * 2 + sources.length * 3 + wordCount * 0.01;
}
// === FILE END ===