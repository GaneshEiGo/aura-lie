// === FILE START ===
// packages/council-engine/src/second-opinion.ts
// PRD §7.9 · FR-WF-07.
//
// Second opinion: a different model family answers independently. Output
// is a claim-level agreement matrix — agreed claims, disputed claims, and
// the main dispute. Agreement percentage is shown only with its claim
// counts, per the PRD ("the agreement percentage is shown only with its
// claim counts").

import type { CouncilSeat, ModelCaller } from './real.js';

export interface SecondOpinionInput {
  question: string;
  original_answer: string;
  original_family: string;
  opinion_seat: CouncilSeat;
  caller: ModelCaller;
}

export interface ClaimAgreement {
  claim: string;
  agreed: boolean;
}

export interface AgreementMatrix {
  total_claims: number;
  agreed_claims: number;
  disputed_claims: number;
  agreement_pct: number | null;
  claims: ClaimAgreement[];
}

export interface SecondOpinionResult {
  second_answer: string;
  matrix: AgreementMatrix;
  main_dispute: string | null;
  calls_used: number;
}

export async function runSecondOpinion(
  input: SecondOpinionInput,
): Promise<SecondOpinionResult> {
  if (input.opinion_seat.model_family === input.original_family) {
    throw new Error('Second opinion must be a different model family');
  }
  const prompt = [
    `Question: ${input.question}`,
    'Answer independently. Do not reference any other answer.',
  ].join('\n');
  const resp = await input.caller({ seat: input.opinion_seat, prompt });
  const matrix = compareClaims(input.original_answer, resp.text);
  const mainDispute = matrix.claims.find((c) => !c.agreed)?.claim ?? null;
  return {
    second_answer: resp.text,
    matrix,
    main_dispute: mainDispute,
    calls_used: 1,
  };
}

function compareClaims(a: string, b: string): AgreementMatrix {
  const claimsA = extractClaims(a);
  const claimsB = extractClaims(b);
  const bSet = new Set(claimsB.map(normalise));
  const claims: ClaimAgreement[] = claimsA.map((c) => ({
    claim: c,
    agreed: bSet.has(normalise(c)),
  }));
  const agreed = claims.filter((c) => c.agreed).length;
  const disputed = claims.length - agreed;
  return {
    total_claims: claims.length,
    agreed_claims: agreed,
    disputed_claims: disputed,
    agreement_pct: claims.length > 0 ? (agreed / claims.length) * 100 : null,
    claims,
  };
}

function extractClaims(text: string): string[] {
  return text
    .split(/[.!?]\s+/)
    .map((s) => s.trim().replace(/[.!?]+$/, '').trim())
    .filter((s) => s.length > 0);
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
// === FILE END ===