// packages/circuit-breaker/test/circuit-breaker.test.ts
import { describe, it, expect } from 'vitest';
import {
  CircuitBreaker,
  BreakerRegistry,
  runWaterfall,
  WaterfallTimeoutError,
  drafterFamilies,
  excludeDrafterFamilies,
  sortByDiversity,
} from '../src/index.js';
import type {
  Candidate,
  Clock,
  ModelFamily,
} from '../src/types.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function fixedClock(at: number): {
  clock: Clock;
  add: (d: number) => void;
  set: (t: number) => void;
  get: () => number;
} {
  let current = at;
  return {
    clock: { now: () => current },
    add: (d: number) => {
      current += d;
    },
    set: (t: number) => {
      current = t;
    },
    get: () => current,
  };
}

function cand(
  family: ModelFamily,
  role: Candidate['role'] = 'chat_fast',
  model = `${family}-model`,
): Candidate {
  return { family, model, role };
}

// -----------------------------------------------------------------------------
describe('Circuit Breaker (PRD 7.8, FR-WF-01, T-14)', () => {
  // ---- Closed state --------------------------------------------------
  it('starts closed and allows attempts', () => {
    const { clock } = fixedClock(0);
    const b = new CircuitBreaker({}, clock);
    expect(b.getState()).toBe('closed');
    expect(b.canAttempt()).toBe(true);
  });

  it('successes in closed state are a no-op', () => {
    const { clock } = fixedClock(0);
    const b = new CircuitBreaker({}, clock);
    for (let i = 0; i < 10; i++) b.recordSuccess();
    expect(b.getState()).toBe('closed');
  });

  // ---- Failure threshold → open -------------------------------------
  it('opens after 3 failures within 60s', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);

    b.recordFailure();
    add(1000);
    b.recordFailure();
    add(1000);
    b.recordFailure();

    expect(b.getState()).toBe('open');
    expect(b.canAttempt()).toBe(false);
  });

  it('stays closed after only 2 failures', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    add(1000);
    b.recordFailure();
    expect(b.getState()).toBe('closed');
    expect(b.canAttempt()).toBe(true);
  });

  it('does not count failures older than 60s', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);

    b.recordFailure();  // t=1000
    add(30_000);        // t=31_000
    b.recordFailure();  // t=31_000
    add(40_000);        // t=71_000 — first failure is now 70s old, pruned
    b.recordFailure();  // t=71_000

    // Only 2 failures in the last 60s window
    expect(b.getState()).toBe('closed');
    expect(b.canAttempt()).toBe(true);
  });

  it('opens with a custom threshold', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({ failureThreshold: 5 }, clock);
    for (let i = 0; i < 4; i++) {
      b.recordFailure();
      add(100);
    }
    expect(b.getState()).toBe('closed');
    b.recordFailure();
    expect(b.getState()).toBe('open');
  });

  // ---- Open → half-open ---------------------------------------------
  it('stays open before the 90s cooldown has elapsed', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(89_000);
    expect(b.getState()).toBe('open');
    expect(b.canAttempt()).toBe(false);
  });

  it('auto-promotes to half-open after 90s', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    expect(b.getState()).toBe('open');
    add(90_000);
    expect(b.getState()).toBe('half-open');
    expect(b.canAttempt()).toBe(true);
  });

  it('supports a custom openDurationMs', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({ openDurationMs: 5_000 }, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(4_000);
    expect(b.getState()).toBe('open');
    add(1_001);
    expect(b.getState()).toBe('half-open');
  });

  // ---- Half-open → closed -------------------------------------------
  it('closes after 2 successes in half-open', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(90_000);
    expect(b.getState()).toBe('half-open');

    b.recordSuccess();
    expect(b.getState()).toBe('half-open');
    b.recordSuccess();
    expect(b.getState()).toBe('closed');
  });

  it('stays half-open after 1 success', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(90_000);
    b.recordSuccess();
    expect(b.getState()).toBe('half-open');
  });

  it('half-open closes with a custom halfOpenSuccesses count', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({ halfOpenSuccesses: 3 }, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(90_000);
    b.recordSuccess();
    b.recordSuccess();
    expect(b.getState()).toBe('half-open');
    b.recordSuccess();
    expect(b.getState()).toBe('closed');
  });

  // ---- Half-open → open on failure ---------------------------------
  it('a failure in half-open reopens the breaker', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(90_000);
    expect(b.getState()).toBe('half-open');
    b.recordFailure();
    expect(b.getState()).toBe('open');
    expect(b.canAttempt()).toBe(false);
  });

  it('reopen from half-open restarts the cooldown clock', () => {
    const { clock, add } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    add(90_000);       // t = 91_000 → half-open
    b.recordFailure(); // reopens at t = 91_000
    add(89_999);       // t = 180_999 → still open
    expect(b.getState()).toBe('open');
    add(1);            // t = 181_000 → half-open again
    expect(b.getState()).toBe('half-open');
  });

  // ---- reset() -----------------------------------------------------
  it('reset returns the breaker to closed', () => {
    const { clock } = fixedClock(1000);
    const b = new CircuitBreaker({}, clock);
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    expect(b.getState()).toBe('open');
    b.reset();
    expect(b.getState()).toBe('closed');
    expect(b.canAttempt()).toBe(true);
  });

  // ---- BreakerRegistry ---------------------------------------------
  it('registry keeps independent state per family', () => {
    const { clock } = fixedClock(1000);
    const r = new BreakerRegistry({}, clock);
    r.recordFailure('groq');
    r.recordFailure('groq');
    r.recordFailure('groq');
    expect(r.getState('groq')).toBe('open');
    expect(r.getState('gemini')).toBe('closed');
    expect(r.canAttempt('groq')).toBe(false);
    expect(r.canAttempt('gemini')).toBe(true);
  });

  it('registry resetAll clears every family', () => {
    const { clock } = fixedClock(1000);
    const r = new BreakerRegistry({}, clock);
    r.recordFailure('groq');
    r.recordFailure('groq');
    r.recordFailure('groq');
    r.recordFailure('gemini');
    r.recordFailure('gemini');
    r.recordFailure('gemini');
    r.resetAll();
    expect(r.getState('groq')).toBe('closed');
    expect(r.getState('gemini')).toBe('closed');
  });

  // ---- Waterfall: happy paths --------------------------------------
  it('returns the first candidate on success', async () => {
    const result = await runWaterfall(
      [cand('groq'), cand('gemini')],
      async () => 'answer',
    );
    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('groq');
    expect(result.attempts.length).toBe(1);
    expect(result.attempts[0].outcome).toBe('success');
  });

  it('falls through to the second candidate when the first fails', async () => {
    const result = await runWaterfall(
      [cand('groq'), cand('gemini')],
      async (c) => {
        if (c.family === 'groq') throw new Error('groq 500');
        return 'gemini-answer';
      },
    );
    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('gemini');
    expect(result.attempts.length).toBe(2);
    expect(result.attempts[0].outcome).toBe('failure');
    expect(result.attempts[1].outcome).toBe('success');
    expect(result.attempts[0].reason).toBe('groq 500');
  });

  it('returns ok:false with attempts when all candidates fail', async () => {
    const result = await runWaterfall(
      [cand('groq'), cand('gemini'), cand('cerebras')],
      async () => {
        throw new Error('boom');
      },
    );
    expect(result.ok).toBe(false);
    expect(result.winner).toBeUndefined();
    expect(result.attempts.length).toBe(3);
    expect(result.attempts.every((a) => a.outcome === 'failure')).toBe(true);
  });

  it('returns ok:false on empty candidates', async () => {
    const result = await runWaterfall([], async () => 'x');
    expect(result.ok).toBe(false);
    expect(result.attempts.length).toBe(0);
  });

  // ---- Waterfall: breaker integration ------------------------------
  it('skips candidates whose breaker is open (PRD 7.4 hard filter #4)', async () => {
    const { clock } = fixedClock(1000);
    const breakers = new BreakerRegistry({}, clock);

    // Open the groq breaker.
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    expect(breakers.getState('groq')).toBe('open');

    let groqCalled = false;
    const result = await runWaterfall(
      [cand('groq'), cand('gemini')],
      async (c) => {
        if (c.family === 'groq') groqCalled = true;
        return 'gemini-answer';
      },
      { breakers, clock },
    );

    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('gemini');
    expect(groqCalled).toBe(false);
    expect(result.attempts[0].outcome).toBe('skipped-breaker');
    expect(result.attempts[1].outcome).toBe('success');
  });

  it('records successes and failures against the registry', async () => {
    const { clock } = fixedClock(1000);
    const breakers = new BreakerRegistry({}, clock);

    await runWaterfall(
      [cand('groq'), cand('gemini')],
      async (c) => {
        if (c.family === 'groq') throw new Error('bad');
        return 'ok';
      },
      { breakers, clock },
    );

    // Groq saw one failure; two more will open it.
    expect(breakers.getState('groq')).toBe('closed');
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    expect(breakers.getState('groq')).toBe('open');

    // Gemini saw one success; state stays closed.
    expect(breakers.getState('gemini')).toBe('closed');
  });

  // ---- Waterfall: excluded families (FR-TRUTH-05) ------------------
  it('skips excluded families (independent-judge rule)', async () => {
    const result = await runWaterfall(
      [cand('groq', 'judge'), cand('gemini', 'judge'), cand('cerebras', 'judge')],
      async () => 'answer',
      { excludeFamilies: ['groq'] },
    );
    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('gemini');
    expect(result.attempts[0].outcome).toBe('skipped-filter');
    expect(result.attempts[1].outcome).toBe('success');
  });

  // ---- Waterfall: T-14 fault injection -----------------------------
  it('T-14: kill provider A → answer arrives via B, no user-visible error', async () => {
    const { clock } = fixedClock(1000);
    const breakers = new BreakerRegistry({}, clock);

    const result = await runWaterfall(
      [cand('groq'), cand('gemini'), cand('cerebras')],
      async (c) => {
        if (c.family === 'groq') throw new Error('ECONNREFUSED');
        return `${c.family}-answer`;
      },
      { breakers, clock },
    );

    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('gemini');
    expect(result.value).toBe('gemini-answer');
    // No error surfaces to the caller — `error` is undefined on success.
    expect(result.error).toBeUndefined();
    // Attempts record the failure so the Route tab can show it.
    expect(result.attempts[0].outcome).toBe('failure');
    expect(result.attempts[0].candidate.family).toBe('groq');
  });

  it('T-14: with provider A already open, waterfall goes straight to B', async () => {
    const { clock } = fixedClock(1000);
    const breakers = new BreakerRegistry({}, clock);
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');

    let groqCalled = false;
    const result = await runWaterfall(
      [cand('groq'), cand('gemini')],
      async (c) => {
        if (c.family === 'groq') groqCalled = true;
        return 'gemini-answer';
      },
      { breakers, clock },
    );

    expect(result.ok).toBe(true);
    expect(groqCalled).toBe(false);
    expect(result.winner?.family).toBe('gemini');
  });

  // ---- Waterfall: timeout ------------------------------------------
  it('falls through on attempt timeout (PRD 7.8: 2.0 s default)', async () => {
    // Use a very short timeout so the test is fast but exercises the real path.
    const never = new Promise<never>(() => {
      /* never resolves */
    });

    const result = await runWaterfall(
      [cand('groq'), cand('gemini')],
      async (c) => {
        if (c.family === 'groq') return never;
        return 'gemini-answer';
      },
      { timeoutMs: 30 },
    );

    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('gemini');
    expect(result.attempts[0].outcome).toBe('timeout');
    expect(result.attempts[1].outcome).toBe('success');
  });

  it('WaterfallTimeoutError carries the timeout duration', () => {
    const err = new WaterfallTimeoutError(2_000);
    expect(err.name).toBe('WaterfallTimeoutError');
    expect(err.message).toContain('2000');
  });

  // ---- Independent judge ------------------------------------------
  it('drafterFamilies returns unique families', () => {
    const families = drafterFamilies([
      cand('groq'),
      cand('groq', 'chat_quality'),
      cand('gemini'),
    ]);
    expect(families.sort()).toEqual(['gemini', 'groq']);
  });

  it('excludeDrafterFamilies removes the drafting families', () => {
    const drafters = [cand('groq'), cand('gemini')];
    const judges = [
      cand('groq', 'judge'),
      cand('gemini', 'judge'),
      cand('cerebras', 'judge'),
    ];
    const eligible = excludeDrafterFamilies(
      judges,
      drafterFamilies(drafters),
    );
    expect(eligible.length).toBe(1);
    expect(eligible[0].family).toBe('cerebras');
  });

  it('judge waterfall with drafter-exclusion runs on a different family', async () => {
    const drafters = [cand('groq'), cand('gemini')];
    const judges = [
      cand('groq', 'judge'),
      cand('gemini', 'judge'),
      cand('cerebras', 'judge'),
    ];
    const excluded = drafterFamilies(drafters);

    const result = await runWaterfall(
      judges,
      async (c) => `verdict-from-${c.family}`,
      { excludeFamilies: excluded },
    );

    expect(result.ok).toBe(true);
    expect(result.winner?.family).toBe('cerebras');
    // The first two candidates were skipped by policy.
    expect(result.attempts[0].outcome).toBe('skipped-filter');
    expect(result.attempts[1].outcome).toBe('skipped-filter');
    expect(result.attempts[2].outcome).toBe('success');
  });

  // ---- Diversity bonus --------------------------------------------
  it('sortByDiversity puts non-generator families first', () => {
    const sorted = sortByDiversity(
      [cand('groq'), cand('gemini'), cand('cerebras')],
      'groq',
    );
    expect(sorted[0].family).not.toBe('groq');
    // Both gemini and cerebras come before groq.
    const groqIndex = sorted.findIndex((c) => c.family === 'groq');
    expect(groqIndex).toBe(sorted.length - 1);
  });
});