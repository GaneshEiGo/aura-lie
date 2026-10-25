// packages/quota-ledger/test/quota-ledger.test.ts
import { describe, it, expect } from 'vitest';
import {
  QuotaLedger,
  DEFAULT_POOL_CONFIGS,
  PLANNING_LIMIT_FRACTION,
  DEFAULT_INTERACTIVE_RESERVE_PCT,
  DEFAULT_429_BACKOFF_MS,
} from '../src/index.js';
import type { LedgerClock, PoolConfig } from '../src/types.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function fixedClock(at: number): {
  clock: LedgerClock;
  add: (d: number) => void;
  set: (t: number) => void;
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
  };
}

const POOL_1000: PoolConfig = { id: 'p', seedLimit: 1000, resetHourUtc: 0 };

// -----------------------------------------------------------------------------
describe('Quota Ledger (PRD 13.6, F-006, T-21, FR-WF-03)', () => {
  // ---- Constants ---------------------------------------------------
  it('PLANNING_LIMIT_FRACTION is 0.8 (PRD 13.6)', () => {
    expect(PLANNING_LIMIT_FRACTION).toBe(0.8);
  });

  it('DEFAULT_INTERACTIVE_RESERVE_PCT is 0.30 (FR-WF-03)', () => {
    expect(DEFAULT_INTERACTIVE_RESERVE_PCT).toBe(0.3);
  });

  it('DEFAULT_429_BACKOFF_MS is 60s (PRD 13.6)', () => {
    expect(DEFAULT_429_BACKOFF_MS).toBe(60_000);
  });

  it('DEFAULT_POOL_CONFIGS match PRD 4.1 / 4.2 seeds', () => {
    const byId = new Map(DEFAULT_POOL_CONFIGS.map((c) => [c.id, c]));
    expect(byId.get('groq-large')?.seedLimit).toBe(200);
    expect(byId.get('groq-8b')?.seedLimit).toBe(330);
    expect(byId.get('gemini-flash-lite')?.seedLimit).toBe(500);
    expect(byId.get('workers-ai-neurons')?.seedLimit).toBe(10_000);
    expect(byId.get('cloudflare-requests')?.seedLimit).toBe(100_000);
  });

  // ---- Planning limit ----------------------------------------------
  it('planning limit starts at 80% of seed (PRD 13.6)', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    const snap = ledger.snapshot('p');
    expect(snap?.planningLimit).toBe(800);
  });

  // ---- Basic reserve / deny ----------------------------------------
  it('reserve succeeds under the planning limit', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    const r = ledger.reserve('p', 100, 'interactive');
    expect(r.ok).toBe(true);
    expect(ledger.snapshot('p')?.used).toBe(100);
  });

  it('reserve denies at the planning limit', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    expect(ledger.reserve('p', 800, 'interactive').ok).toBe(true);
    const denied = ledger.reserve('p', 1, 'interactive');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('daily-limit');
  });

  it('reserve on unknown pool returns unknown-pool', () => {
    const { clock } = fixedClock(0);
    const ledger = new QuotaLedger([POOL_1000], clock);
    const r = ledger.reserve('ghost', 1, 'interactive');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-pool');
  });

  // ---- FR-WF-03: background reserve guard --------------------------
  it('background refused when interactive reserve drops below 30%', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);

    // Use 600 of 800 → 200 remaining = 25% < 30%
    expect(ledger.reserve('p', 600, 'interactive').ok).toBe(true);
    const bg = ledger.reserve('p', 1, 'background');
    expect(bg.ok).toBe(false);
    if (!bg.ok) expect(bg.reason).toBe('interactive-reserve');
  });

  it('interactive still allowed when reserve is below 30%', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    expect(ledger.reserve('p', 600, 'interactive').ok).toBe(true);
    // 200 of 800 left = 25% — interactive is fine.
    expect(ledger.reserve('p', 100, 'interactive').ok).toBe(true);
  });

  it('verify is not capped by the background guard', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    expect(ledger.reserve('p', 600, 'interactive').ok).toBe(true);
    expect(ledger.reserve('p', 100, 'verify').ok).toBe(true);
  });

  it('background allowed when reserve is still above 30%', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    // 400 of 800 used = 50% left.
    expect(ledger.reserve('p', 400, 'interactive').ok).toBe(true);
    expect(ledger.reserve('p', 50, 'background').ok).toBe(true);
  });

  // ---- commit: refund / overcharge ---------------------------------
  it('commit refunds the difference (actual < est)', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    const r = ledger.reserve('p', 100, 'interactive');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ledger.snapshot('p')?.used).toBe(100);
    ledger.commit(r.token.id, 30);
    expect(ledger.snapshot('p')?.used).toBe(30);
    expect(ledger.pendingTokens()).toBe(0);
  });

  it('commit charges the extra (actual > est)', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    const r = ledger.reserve('p', 100, 'interactive');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    ledger.commit(r.token.id, 250);
    expect(ledger.snapshot('p')?.used).toBe(250);
  });

  it('commit is idempotent (unknown token is a no-op)', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    ledger.commit('ghost-token', 100);
    expect(ledger.snapshot('p')?.used).toBe(0);
  });

  // ---- on429 ------------------------------------------------------
  it('on429 blocks the pool until the given reset time', () => {
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);

    const resetAt = clock.now() + 30_000;
    ledger.on429('p', { resetAt });

    const blocked = ledger.reserve('p', 1, 'interactive');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe('blocked');
      expect(blocked.nextResetAt).toBe(new Date(resetAt).toISOString());
    }

    // Advance past resetAt — reserve succeeds again.
    add(30_001);
    expect(ledger.reserve('p', 1, 'interactive').ok).toBe(true);
  });

  it('on429 uses a default 60s backoff when resetAt is omitted', () => {
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    ledger.on429('p');

    expect(ledger.reserve('p', 1, 'interactive').ok).toBe(false);
    add(DEFAULT_429_BACKOFF_MS + 1);
    expect(ledger.reserve('p', 1, 'interactive').ok).toBe(true);
  });

  it('on429 with observedLimit relaxes planningLimit up to seed', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    // Planning starts at 800.
    expect(ledger.snapshot('p')?.planningLimit).toBe(800);
    ledger.on429('p', { observedLimit: 950 });
    expect(ledger.snapshot('p')?.planningLimit).toBe(950);
  });

  it('learnLimit never exceeds seedLimit', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    ledger.learnLimit('p', 50_000); // way above seed
    expect(ledger.snapshot('p')?.planningLimit).toBe(1000); // capped at seed
  });

  it('learnLimit never goes below current planningLimit', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    ledger.learnLimit('p', 100); // lower than 800
    expect(ledger.snapshot('p')?.planningLimit).toBe(800);
  });

  // ---- Daily rollover ---------------------------------------------
  it('daily rollover resets used at UTC midnight', () => {
    const { clock, add } = fixedClock(
      new Date(Date.UTC(2026, 9, 20, 23, 59, 0)).getTime(),
    );
    const ledger = new QuotaLedger([POOL_1000], clock);

    // Use up the entire planning limit.
    expect(ledger.reserve('p', 800, 'interactive').ok).toBe(true);
    expect(ledger.reserve('p', 1, 'interactive').ok).toBe(false);

    // Advance past 00:00 UTC — rollover clears used.
    add(2 * 60 * 1000); // 23:59 → 00:01 next day
    expect(ledger.snapshot('p')?.used).toBe(0);
    expect(ledger.reserve('p', 800, 'interactive').ok).toBe(true);
  });

  it('daily rollover respects a custom resetHourUtc', () => {
    // Pool resets at 06:00 UTC.
    const pool: PoolConfig = { id: 'p', seedLimit: 1000, resetHourUtc: 6 };
    const { clock, set } = fixedClock(
      new Date(Date.UTC(2026, 9, 20, 5, 0, 0)).getTime(),
    );
    const ledger = new QuotaLedger([pool], clock);

    // 05:00 UTC: current usage window started at 06:00 the day before.
    expect(ledger.reserve('p', 800, 'interactive').ok).toBe(true);
    expect(ledger.snapshot('p')?.used).toBe(800);

    // Advance to 07:00 UTC — past 06:00 → new usage window → used reset.
    set(new Date(Date.UTC(2026, 9, 20, 7, 0, 0)).getTime());
    expect(ledger.snapshot('p')?.used).toBe(0);
  });

  // ---- Snapshot shape (Appendix C) --------------------------------
  it('snapshot matches Appendix C PoolSnapshot shape', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    ledger.reserve('p', 100, 'interactive');
    const snap = ledger.snapshot('p');
    expect(snap).not.toBeNull();
    expect(typeof snap?.pool).toBe('string');
    expect(typeof snap?.used).toBe('number');
    expect(typeof snap?.planningLimit).toBe('number');
    expect(typeof snap?.resetsAt).toBe('string');
    // resetsAt must be a valid ISO-8601 timestamp.
    expect(Number.isFinite(Date.parse(snap!.resetsAt!))).toBe(true);
  });

  it('snapshot includes blockedUntil as ISO when the pool is blocked', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    const resetAt = clock.now() + 60_000;
    ledger.on429('p', { resetAt });
    const snap = ledger.snapshot('p');
    expect(snap?.blockedUntil).toBe(new Date(resetAt).toISOString());
  });

  it('snapshot omits blockedUntil when the pool is not blocked', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    expect(ledger.snapshot('p')?.blockedUntil).toBeUndefined();
  });

  it('snapshotAll returns one entry per pool', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger(
      [
        { id: 'a', seedLimit: 100 },
        { id: 'b', seedLimit: 200 },
      ],
      clock,
    );
    const all = ledger.snapshotAll();
    expect(all.length).toBe(2);
    expect(all.map((s) => s.pool).sort()).toEqual(['a', 'b']);
  });

  // ---- T-21: 1,000 parallel reserves never overspend ---------------
  it('T-21: 1,000 parallel reserves of 1 each never overspend (limit 800)', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);

    const results = await Promise.all(
      Array.from({ length: 1000 }, () =>
        Promise.resolve().then(() => ledger.reserve('p', 1, 'interactive')),
      ),
    );

    const successes = results.filter((r) => r.ok).length;
    const snap = ledger.snapshot('p')!;
    // Exactly 800 successes = planningLimit.
    expect(successes).toBe(800);
    expect(snap.used).toBe(800);
    expect(snap.used).toBeLessThanOrEqual(snap.planningLimit);
  });

  it('T-21: 1,000 parallel reserves starting mid-window never overspend', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);
    // Pre-consume 500.
    expect(ledger.reserve('p', 500, 'interactive').ok).toBe(true);

    const results = await Promise.all(
      Array.from({ length: 1000 }, () =>
        Promise.resolve().then(() => ledger.reserve('p', 1, 'interactive')),
      ),
    );

    const successes = results.filter((r) => r.ok).length;
    const snap = ledger.snapshot('p')!;
    // 300 more fit (500 + 300 = 800).
    expect(successes).toBe(300);
    expect(snap.used).toBe(800);
    expect(snap.used).toBeLessThanOrEqual(snap.planningLimit);
  });

  it('T-21: interleaved reserve + commit never exceeds the planning limit', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = new QuotaLedger([POOL_1000], clock);

    // Each reservation requests est=10, commits actual=5. Net use per success = 5.
    // Some calls will hit daily-limit; all such calls refund via commit anyway.
    const tasks = Array.from({ length: 1000 }, () =>
      Promise.resolve().then(() => {
        const r = ledger.reserve('p', 10, 'interactive');
        if (r.ok) ledger.commit(r.token.id, 5);
        return r;
      }),
    );
    await Promise.all(tasks);

    const snap = ledger.snapshot('p')!;
    // Whatever succeeded, used ≤ planningLimit at every point.
    expect(snap.used).toBeLessThanOrEqual(snap.planningLimit);
    expect(snap.used).toBeGreaterThanOrEqual(0);
  });
});