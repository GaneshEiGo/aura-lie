// === FILE START ===
// packages/quota-ledger/test/t21-concurrency.test.ts
// PRD 13.6 · FR-WF-03 · T-21.
//
// The T-21 gate: 1,000 parallel reserves never overspend, plus the proof
// that the per-pool queue is what makes it safe.

import { describe, it, expect } from 'vitest';
import {
  DurableLedger,
  type LedgerPoolConfig,
  type Purpose,
} from '../src/durable-ledger.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function makeLedger(
  pools: LedgerPoolConfig[],
  now: () => number = () => T0,
): DurableLedger {
  return new DurableLedger({ pools, now });
}

const onePool: LedgerPoolConfig = {
  id: 'p',
  dailySeed: 125, // planningLimit will be 100 (floor(125 * 0.8))
  interactiveReservePct: 1,
};

// =============================================================================
// Construction + defaults
// =============================================================================

describe('DurableLedger — construction', () => {
  it('default planning limit is 80% of daily seed', () => {
    const l = makeLedger([{ id: 'p', dailySeed: 1000, interactiveReservePct: 1 }]);
    expect(l.getState('p')!.planningLimit).toBe(800);
  });

  it('explicit planning limit overrides the default', () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 1000, planningLimit: 500, interactiveReservePct: 1 },
    ]);
    expect(l.getState('p')!.planningLimit).toBe(500);
  });

  it('unknown pool state returns null', () => {
    const l = makeLedger([onePool]);
    expect(l.getState('nope')).toBeNull();
  });
});

// =============================================================================
// Basic reserve / commit / release
// =============================================================================

describe('DurableLedger — reserve / commit / release', () => {
  it('reserve succeeds within limit', () => {
    const l = makeLedger([onePool]);
    const out = l.reserve('p', 1, 'interactive');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.token.poolId).toBe('p');
    expect(l.getState('p')!.used).toBe(1);
  });

  it('reserve fails when exhausted', () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 125, planningLimit: 2, interactiveReservePct: 1 },
    ]);
    expect(l.reserve('p', 1, 'interactive').ok).toBe(true);
    expect(l.reserve('p', 1, 'interactive').ok).toBe(true);
    const denied = l.reserve('p', 1, 'interactive');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('exhausted');
  });

  it('commit with actual < est refunds difference', () => {
    const l = makeLedger([onePool]);
    const out = l.reserve('p', 5, 'interactive');
    if (!out.ok) throw new Error('reserve failed');
    l.commit(out.token, 2);
    expect(l.getState('p')!.used).toBe(2);
  });

  it('commit with actual = est is a no-op', () => {
    const l = makeLedger([onePool]);
    const out = l.reserve('p', 5, 'interactive');
    if (!out.ok) throw new Error('reserve failed');
    l.commit(out.token, 5);
    expect(l.getState('p')!.used).toBe(5);
  });

  it('release refunds fully', () => {
    const l = makeLedger([onePool]);
    const out = l.reserve('p', 5, 'interactive');
    if (!out.ok) throw new Error('reserve failed');
    l.release(out.token);
    expect(l.getState('p')!.used).toBe(0);
  });

  it('commit with actual > est clamps (no negative usage)', () => {
    const l = makeLedger([onePool]);
    const out = l.reserve('p', 5, 'interactive');
    if (!out.ok) throw new Error('reserve failed');
    l.commit(out.token, 999);
    expect(l.getState('p')!.used).toBe(5);
  });
});

// =============================================================================
// 429 handling
// =============================================================================

describe('DurableLedger — 429 handling', () => {
  it('onProvider429 blocks the pool until the window expires', () => {
    let now = T0;
    const l = makeLedger([onePool], () => now);
    l.onProvider429('p', 30_000);
    const denied = l.reserve('p', 1, 'interactive');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe('blocked');
      expect(denied.nextResetAt).toBe(T0 + 30_000);
    }
    now = T0 + 30_001;
    expect(l.reserve('p', 1, 'interactive').ok).toBe(true);
  });

  it('second 429 takes the max of both blocks', () => {
    let now = T0;
    const l = makeLedger([onePool], () => now);
    l.onProvider429('p', 10_000);
    l.onProvider429('p', 60_000);
    now = T0 + 30_000;
    expect(l.reserve('p', 1, 'interactive').ok).toBe(false);
  });
});

// =============================================================================
// Daily reset
// =============================================================================

describe('DurableLedger — UTC midnight reset', () => {
  it('used count resets at UTC 00:00', () => {
    let now = Date.UTC(2026, 9, 2, 23, 0, 0); // 1 hour before midnight
    const l = makeLedger([onePool], () => now);
    for (let i = 0; i < 100; i++) l.reserve('p', 1, 'interactive');
    expect(l.getState('p')!.used).toBe(100);
    now = Date.UTC(2026, 9, 3, 0, 0, 1);
    expect(l.getState('p')!.used).toBe(0);
  });

  it('exhausted pool becomes available after reset', () => {
    let now = Date.UTC(2026, 9, 2, 23, 0, 0);
    const l = makeLedger(
      [{ id: 'p', dailySeed: 100, planningLimit: 2, interactiveReservePct: 1 }],
      () => now,
    );
    l.reserve('p', 1, 'interactive');
    l.reserve('p', 1, 'interactive');
    expect(l.reserve('p', 1, 'interactive').ok).toBe(false);
    now = Date.UTC(2026, 9, 3, 0, 0, 1);
    expect(l.reserve('p', 1, 'interactive').ok).toBe(true);
  });
});

// =============================================================================
// FR-WF-03 — background refuses when interactive reserve < 30%
// =============================================================================

describe('FR-WF-03 — background reserve protection', () => {
  it('background refused when interactive pool is > 70% used', () => {
    const l = makeLedger([
      { id: 'interactive', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
      { id: 'bg', dailySeed: 100, planningLimit: 100, interactiveReservePct: 0 },
    ]);
    // Burn 71% of interactive → 71/100 used, remaining = 29%
    for (let i = 0; i < 71; i++) l.reserve('interactive', 1, 'interactive');
    const denied = l.reserve('bg', 1, 'background');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('background_reserve');
  });

  it('background allowed when interactive reserve is > 30%', () => {
    const l = makeLedger([
      { id: 'interactive', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
      { id: 'bg', dailySeed: 100, planningLimit: 100, interactiveReservePct: 0 },
    ]);
    // Burn 50% → 50% remaining
    for (let i = 0; i < 50; i++) l.reserve('interactive', 1, 'interactive');
    expect(l.reserve('bg', 1, 'background').ok).toBe(true);
  });

  it('interactive and verify purposes are never blocked by the reserve rule', () => {
    const l = makeLedger([onePool]);
    for (let i = 0; i < 95; i++) l.reserve('p', 1, 'interactive');
    // Still allow interactive and verify
    expect(l.reserve('p', 1, 'interactive').ok).toBe(true);
    expect(l.reserve('p', 1, 'verify').ok).toBe(true);
  });
});

// =============================================================================
// T-21 GATE — 1,000 parallel reserves never overspend
// =============================================================================

describe('T-21 GATE — concurrency guarantees', () => {
  it('1,000 concurrent reserveAsync calls → exactly 100 succeed (limit = 100)', async () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
    ]);
    const promises: Array<ReturnType<typeof l.reserveAsync>> = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(l.reserveAsync('p', 1, 'interactive'));
    }
    const results = await Promise.all(promises);
    const okCount = results.filter((r) => r.ok).length;
    const deniedCount = results.length - okCount;

    expect(okCount).toBe(100);
    expect(deniedCount).toBe(900);
    expect(l.getState('p')!.used).toBe(100);
  });

  it('10,000 concurrent reserves never overspend (limit = 1000)', async () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 1250, planningLimit: 1000, interactiveReservePct: 1 },
    ]);
    const promises: Array<ReturnType<typeof l.reserveAsync>> = [];
    for (let i = 0; i < 10_000; i++) {
      promises.push(l.reserveAsync('p', 1, 'interactive'));
    }
    const results = await Promise.all(promises);
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(1000);
    expect(l.getState('p')!.used).toBe(1000);
  });

  it('mixed reserve + commit + release never overspends', async () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
    ]);
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 300; i++) {
      promises.push(
        (async () => {
          const r = await l.reserveAsync('p', 1, 'interactive');
          if (!r.ok) return;
          // Even turns refund fully, odd turns commit fully
          if (i % 2 === 0) await l.releaseAsync(r.token);
          else await l.commitAsync(r.token, 1);
        })(),
      );
    }
    await Promise.all(promises);
    const state = l.getState('p')!;
    // 150 released back, 150 committed → exactly 100 succeeded originally? No:
    // Some failed reserve (limit hit), so successful count ≤ 100. Released
    // ones return to 0 capacity. Committed ones stay used.
    expect(state.used).toBeLessThanOrEqual(100);
    // Critical invariant: never exceeds the limit
    expect(state.used).toBeLessThanOrEqual(state.planningLimit);
  });
});

// =============================================================================
// T-21 — the queue is what makes it safe (proves the fix)
// =============================================================================

describe('T-21 — the per-pool queue prevents overspend', () => {
  it('UNSAFE yielding reserve WITHOUT queue → overspends (proves race exists)', async () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
    ]);
    const promises: Array<ReturnType<typeof l._reserveYieldingForTest>> = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(l._reserveYieldingForTest('p', 1));
    }
    const results = await Promise.all(promises);
    const okCount = results.filter((r) => r.ok).length;

    // Without the queue, every caller reads used=0 during the check and
    // every caller increments. Total success >> limit. This is the bug.
    expect(okCount).toBeGreaterThan(100);
    expect(l.getState('p')!.used).toBeGreaterThan(100);
  });

  it('YIELDING reserve WITH queue → exactly 100 succeed (proves fix)', async () => {
    const l = makeLedger([
      { id: 'p', dailySeed: 125, planningLimit: 100, interactiveReservePct: 1 },
    ]);
    const promises: Array<ReturnType<typeof l.reserveAsyncWithYield>> = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(l.reserveAsyncWithYield('p', 1));
    }
    const results = await Promise.all(promises);
    const okCount = results.filter((r) => r.ok).length;

    // With the queue, executions are serialized. Exactly 100 succeed.
    expect(okCount).toBe(100);
    expect(l.getState('p')!.used).toBe(100);
  });
});

// =============================================================================
// Parallel pools do not interfere
// =============================================================================

describe('DurableLedger — parallel pools', () => {
  it('concurrent reserves on different pools track independently', async () => {
    const l = makeLedger([
      { id: 'a', dailySeed: 125, planningLimit: 50, interactiveReservePct: 1 },
      { id: 'b', dailySeed: 125, planningLimit: 50, interactiveReservePct: 1 },
    ]);
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 100; i++) {
      promises.push(l.reserveAsync('a', 1, 'interactive'));
      promises.push(l.reserveAsync('b', 1, 'interactive'));
    }
    await Promise.all(promises);
    expect(l.getState('a')!.used).toBe(50);
    expect(l.getState('b')!.used).toBe(50);
  });
});

// =============================================================================
// limitSeen observation
// =============================================================================

describe('DurableLedger — limit observation', () => {
  it('observeLimit records the observed value', () => {
    const l = makeLedger([onePool]);
    l.observeLimit('p', 5000);
    expect(l.getState('p')!.limitSeen).toBe(5000);
  });

  it('limitSeen is null before observation', () => {
    const l = makeLedger([onePool]);
    expect(l.getState('p')!.limitSeen).toBeNull();
  });
});

// =============================================================================
// getAllStates
// =============================================================================

describe('DurableLedger — getAllStates', () => {
  it('returns a snapshot for every configured pool', () => {
    const l = makeLedger([
      { id: 'a', dailySeed: 100, interactiveReservePct: 1 },
      { id: 'b', dailySeed: 200, interactiveReservePct: 0.5 },
    ]);
    const states = l.getAllStates();
    expect(states.length).toBe(2);
    expect(states.map((s) => s.poolId).sort()).toEqual(['a', 'b']);
  });
});
// === FILE END ===