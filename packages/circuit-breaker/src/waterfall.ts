// packages/circuit-breaker/src/waterfall.ts
// PRD 7.8 + FR-WF-01: waterfall per role, 2.0 s timeout per attempt,
// circuit breaker on every provider.

import { BreakerRegistry } from './breaker.js';
import type {
  AttemptOutcome,
  Candidate,
  Clock,
  ModelFamily,
  WaterfallAttempt,
  WaterfallResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 2_000;

export class WaterfallTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`attempt timed out after ${timeoutMs}ms`);
    this.name = 'WaterfallTimeoutError';
  }
}

export interface WaterfallOptions {
  /** PRD 7.8: default 2.0 s. */
  timeoutMs?: number;
  /** Injected clock for tests. */
  clock?: Clock;
  /** Families to skip (e.g. for the independent-judge rule, FR-TRUTH-05). */
  excludeFamilies?: ModelFamily[];
  /** Shared registry so breaker state survives across requests. */
  breakers?: BreakerRegistry;
  /** Real timer impl override for tests. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type AttemptFn = (candidate: Candidate) => Promise<unknown>;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  setTimer: (cb: () => void, ms: number) => unknown,
  clearTimer: (h: unknown) => void,
  timeoutMsForError: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handle = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new WaterfallTimeoutError(timeoutMsForError));
    }, ms);

    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        reject(e);
      },
    );
  });
}

export async function runWaterfall(
  candidates: Candidate[],
  attempt: AttemptFn,
  options: WaterfallOptions = {},
): Promise<WaterfallResult> {
  const clock = options.clock ?? { now: () => Date.now() };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exclude = new Set<ModelFamily>(options.excludeFamilies ?? []);
  const breakers = options.breakers;
  const setTimer =
    options.setTimer ??
    ((cb, ms) => setTimeout(cb, ms) as unknown);
  const clearTimer =
    options.clearTimer ??
    ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const attempts: WaterfallAttempt[] = [];

  for (const candidate of candidates) {
    // Hard filter: family excluded (e.g. independent judge)
    if (exclude.has(candidate.family)) {
      attempts.push({
        candidate,
        outcome: 'skipped-filter',
        reason: `family ${candidate.family} excluded by policy`,
        durationMs: 0,
      });
      continue;
    }

    // Hard filter: breaker not closed (PRD 7.4 hard filter #4)
    if (breakers && !breakers.canAttempt(candidate.family)) {
      attempts.push({
        candidate,
        outcome: 'skipped-breaker',
        reason: `breaker is ${breakers.getState(candidate.family)} for ${candidate.family}`,
        durationMs: 0,
      });
      continue;
    }

    const start = clock.now();
    let outcome: AttemptOutcome = 'failure';
    let value: unknown;
    let reason: string | undefined;

    try {
      value = await withTimeout(
        attempt(candidate),
        timeoutMs,
        setTimer,
        clearTimer,
        timeoutMs,
      );
      outcome = 'success';
      breakers?.recordSuccess(candidate.family);
    } catch (err) {
      if (err instanceof WaterfallTimeoutError) {
        outcome = 'timeout';
        reason = err.message;
      } else {
        outcome = 'failure';
        reason = err instanceof Error ? err.message : String(err);
      }
      breakers?.recordFailure(candidate.family);
    }

    const durationMs = clock.now() - start;
    attempts.push({ candidate, outcome, reason, durationMs });

    if (outcome === 'success') {
      return { ok: true, winner: candidate, value, attempts };
    }
  }

  return {
    ok: false,
    attempts,
    error: 'all candidates exhausted',
  };
}