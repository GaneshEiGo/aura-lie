// packages/circuit-breaker/src/types.ts
// PRD 7.8, 7.4, 7.15, FR-WF-01, FR-TRUTH-05.

export type ModelRole =
  | 'chat_fast'
  | 'chat_quality'
  | 'reasoner'
  | 'judge'
  | 'vision'
  | 'embed'
  | 'utility'
  | 'long_context';

export type ModelFamily =
  | 'groq'
  | 'gemini'
  | 'cerebras'
  | 'workers-ai'
  | 'openrouter'
  | 'mistral'
  | 'nvidia'
  | 'github';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface BreakerConfig {
  /** PRD 7.8: default 3 failures. */
  failureThreshold?: number;
  /** PRD 7.8: default 60_000 ms. */
  failureWindowMs?: number;
  /** PRD 7.8: default 90_000 ms. */
  openDurationMs?: number;
  /** PRD 7.8: default 2 successes to close. */
  halfOpenSuccesses?: number;
}

export interface Candidate {
  family: ModelFamily;
  model: string;
  role: ModelRole;
}

export type AttemptOutcome =
  | 'success'
  | 'failure'
  | 'timeout'
  | 'skipped-breaker'
  | 'skipped-filter';

export interface WaterfallAttempt {
  candidate: Candidate;
  outcome: AttemptOutcome;
  reason?: string;
  durationMs: number;
}

export interface WaterfallResult {
  ok: boolean;
  winner?: Candidate;
  value?: unknown;
  attempts: WaterfallAttempt[];
  error?: string;
}

export interface Clock {
  now(): number;
}