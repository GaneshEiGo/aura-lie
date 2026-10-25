// packages/truth-pipeline/src/judge.ts
// PRD 8.3 step 5–6: quote-span + entailment judge.
// FR-TRUTH-05: the judge must be a different model family from the drafter.

import { runWaterfall, excludeDrafterFamilies } from '@aura-lie/circuit-breaker';
import type {
  Candidate,
  BreakerRegistry,
  ModelFamily,
} from '@aura-lie/circuit-breaker';
import type { JudgeFn, JudgeVerdict } from './types.js';

export interface RunJudgeOptions {
  candidates: Candidate[];
  judgeFn: JudgeFn;
  claim: string;
  passage: string;
  drafterFamily?: ModelFamily;
  breakers?: BreakerRegistry;
  clock?: { now(): number };
}

export async function runJudge(
  options: RunJudgeOptions,
): Promise<{ verdict: JudgeVerdict; winner: Candidate } | null> {
  const exclusions = options.drafterFamily ? [options.drafterFamily] : [];
  const eligible = excludeDrafterFamilies(options.candidates, exclusions);
  const pool = eligible.length > 0 ? eligible : options.candidates;
  if (pool.length === 0) return null;

  const result = await runWaterfall(
    pool,
    (candidate) => options.judgeFn(candidate, options.claim, options.passage),
    { breakers: options.breakers, clock: options.clock },
  );

  if (!result.ok || !result.value) return null;

  const verdict = result.value as JudgeVerdict;
  if (!verdict || typeof verdict.stance !== 'string') return null;
  if (!result.winner) return null;

  return { verdict, winner: result.winner };
}