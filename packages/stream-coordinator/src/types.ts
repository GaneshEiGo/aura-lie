// packages/stream-coordinator/src/types.ts
// PRD 13.7, 13.8, T-23.

import type { ChatEvent } from '@aura-lie/stream-proxy';

/** PRD 13.7: kinds of work that must be split into resumable slices. */
export type JobKind =
  | 'research'
  | 'council'
  | 'file-ingest'
  | 're-embed'
  | 'mission';

export type JobStatus = 'running' | 'done' | 'stopped' | 'errored';

/**
 * What a single bounded slice produces.
 * PRD 13.7: "The Worker processes a bounded slice (under 35 subrequests)."
 */
export interface StepOutcome<TState = unknown> {
  /** The next job.state for the following step. */
  state: TState;
  /** Artifacts (claims, sources, chunks, etc.) — caller decides shape. */
  artifacts: unknown[];
  /** PRD 13.3: subrequests spent. Must stay ≤ cap; exceeded → do not advance. */
  subrequestsUsed: number;
}

/** One cached step, keyed by the client's input token (idempotency). */
export interface CachedStep<TState = unknown> {
  outcome: StepOutcome<TState>;
  at: number;
}

/**
 * The persisted job state — exactly PRD 13.7's required fields plus the
 * extras needed for correctness (id, totalSteps, stepResults, status).
 */
export interface JobState<TState = unknown> {
  id: string;
  kind: JobKind;
  state: TState;
  /** Index of the NEXT step to run (0-based). Equals totalSteps when done. */
  cursor: number;
  /** Total StepFn invocations across the job. */
  attempts: number;
  totalSteps: number;
  status: JobStatus;
  startAt: number;
  updatedAt: number;
  /** When scheduled (Queue/Cron); null when actively streamable. */
  nextRunAt: number | null;
  /** Idempotency cache: clientToken → cached outcome. */
  stepResults: Record<string, CachedStep<TState>>;
  lastError?: string;
}

/** The step-executor signature. Called once per runSlice, per cursor. */
export type StepFn<TState = unknown> = (
  state: TState,
  cursor: number,
  job: JobState<TState>,
) => Promise<StepOutcome<TState>>;

/** Storage contract — matches Durable Object SQLite storage in prod. */
export interface JobStore {
  get(id: string): JobState | undefined;
  put(job: JobState): void;
  delete(id: string): void;
  list(): JobState[];
}

export interface CreateJobOptions<TState = unknown> {
  kind: JobKind;
  totalSteps: number;
  initial: TState;
  id?: string;
  now?: number;
}

export interface RunSliceOptions<TState = unknown> {
  stepFn: StepFn<TState>;
  store: JobStore;
  /** The token the client sends. Must match a valid prior token or `init`. */
  clientToken: string;
  /** PRD 13.3: default 35. */
  maxSubrequestsPerSlice?: number;
  /** Clock for tests; defaults to `Date.now`. */
  clock?: { now(): number };
}

export interface SliceBudget {
  cap: number;
  used: number;
  exceeded: boolean;
}

export interface SliceResult<TState = unknown> {
  job: JobState<TState>;
  done: boolean;
  cached: boolean;
  budget: SliceBudget;
  outcome?: StepOutcome<TState>;
  nextToken?: string;
  continueEvent?: ChatEvent;
  error?: string;
}

/** T-23: offline queue item. */
export interface OutboxItem {
  key: string;
  payload: unknown;
  enqueuedAt: number;
}

export interface OutboxFlushResult {
  sent: number;
  failed: number;
}

/** PRD 13.3: default subrequest cap per slice. */
export const DEFAULT_SUBREQUEST_CAP_PER_SLICE = 35;