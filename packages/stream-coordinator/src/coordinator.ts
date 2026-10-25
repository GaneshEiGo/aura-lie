// packages/stream-coordinator/src/coordinator.ts
// PRD 13.7: bounded slices, cursor saves, idempotent retries, continue tokens.

import type { ChatEvent } from '@aura-lie/stream-proxy';
import {
  DEFAULT_SUBREQUEST_CAP_PER_SLICE,
  type CreateJobOptions,
  type JobState,
  type RunSliceOptions,
  type SliceResult,
} from './types.js';
import { initialToken, stepTokenFor } from './tokens.js';

// ---------------------------------------------------------------------------
// createJob — PRD 13.7 initial state
// ---------------------------------------------------------------------------

export function createJob<TState = unknown>(
  opts: CreateJobOptions<TState>,
): JobState<TState> {
  if (!Number.isFinite(opts.totalSteps) || opts.totalSteps < 1) {
    throw new Error(`createJob: totalSteps must be ≥ 1 (got ${opts.totalSteps})`);
  }
  const now = opts.now ?? Date.now();
  const id =
    opts.id ?? `job-${opts.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    kind: opts.kind,
    state: opts.initial,
    cursor: 0,
    attempts: 0,
    totalSteps: opts.totalSteps,
    status: 'running',
    startAt: now,
    updatedAt: now,
    nextRunAt: null,
    stepResults: {},
  };
}

// ---------------------------------------------------------------------------
// cancelJob — user taps Stop (PRD 13.7 "with a stop button")
// ---------------------------------------------------------------------------

export function cancelJob<TState>(
  job: JobState<TState>,
  now = Date.now(),
): JobState<TState> {
  if (job.status === 'done' || job.status === 'stopped') return job;
  return { ...job, status: 'stopped', updatedAt: now };
}

// ---------------------------------------------------------------------------
// runSlice — process one bounded slice
// ---------------------------------------------------------------------------

export async function runSlice<TState = unknown>(
  job: JobState<TState>,
  options: RunSliceOptions<TState>,
): Promise<SliceResult<TState>> {
  const cap =
    options.maxSubrequestsPerSlice ?? DEFAULT_SUBREQUEST_CAP_PER_SLICE;
  const now = (options.clock ?? { now: () => Date.now() }).now();

  // -------- Terminal statuses: return immediately (cached final) ---------
  if (job.status === 'done' || job.status === 'stopped') {
    return {
      job,
      done: true,
      cached: true,
      budget: { cap, used: 0, exceeded: false },
    };
  }

  // -------- Idempotency: cache hit on the client's token -----------------
  const cached = job.stepResults[options.clientToken];
  if (cached) {
    const exceeded = cached.outcome.subrequestsUsed > cap;
    const isDone = job.status === 'done' || job.cursor >= job.totalSteps;
    return {
      job,
      done: isDone,
      cached: true,
      budget: {
        cap,
        used: cached.outcome.subrequestsUsed,
        exceeded,
      },
      outcome: cached.outcome,
      nextToken: isDone || exceeded ? undefined : stepTokenFor(job),
      continueEvent:
        isDone || exceeded
          ? undefined
          : continueFor(job, stepTokenFor(job)),
    };
  }

  // -------- Execute the step ---------------------------------------------
  let outcome;
  try {
    outcome = await options.stepFn(job.state, job.cursor, job);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const erroredJob: JobState<TState> = {
      ...job,
      status: 'errored',
      lastError: error,
      updatedAt: now,
    };
    options.store.put(erroredJob);
    return {
      job: erroredJob,
      done: true,
      cached: false,
      budget: { cap, used: 0, exceeded: false },
      error,
    };
  }

  const exceeded = outcome.subrequestsUsed > cap;

  const withCache: JobState<TState> = {
    ...job,
    attempts: job.attempts + 1,
    updatedAt: now,
    stepResults: {
      ...job.stepResults,
      [options.clientToken]: { outcome, at: now },
    },
  };

  // -------- Budget exceeded: cache + do NOT advance ---------------------
  if (exceeded) {
    options.store.put(withCache);
    return {
      job: withCache,
      done: false,
      cached: false,
      budget: { cap, used: outcome.subrequestsUsed, exceeded: true },
      outcome,
      error: `step exceeded ${cap} subrequests (used ${outcome.subrequestsUsed}); split the step or raise the cap`,
    };
  }

  // -------- Advance ------------------------------------------------------
  const nextCursor = job.cursor + 1;
  const isDone = nextCursor >= job.totalSteps;
  const finalJob: JobState<TState> = {
    ...withCache,
    state: outcome.state,
    cursor: nextCursor,
    status: isDone ? 'done' : 'running',
  };
  options.store.put(finalJob);

  const nextToken = isDone ? undefined : stepTokenFor(finalJob);

  return {
    job: finalJob,
    done: isDone,
    cached: false,
    budget: { cap, used: outcome.subrequestsUsed, exceeded: false },
    outcome,
    nextToken,
    continueEvent: nextToken ? continueFor(finalJob, nextToken) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function continueFor<TState>(
  job: JobState<TState>,
  nextToken: string,
): ChatEvent {
  return {
    t: 'continue',
    stepToken: nextToken,
    reason: `${job.cursor} of ${job.totalSteps} steps complete (PRD 13.7)`,
  };
}

/** A convenience: the token the client should send to resume this job. */
export function currentToken<TState>(job: JobState<TState>): string {
  if (job.status === 'done' || job.status === 'stopped') {
    return initialToken(job); // informational only
  }
  if (job.cursor === 0) return initialToken(job);
  return stepTokenFor(job);
}