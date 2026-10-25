// === FILE START ===
// packages/truth-score/test/broker.test.ts
// PRD 8.5 · F-032 · FR-TRUTH-03 · FR-WF-03 · T-29.
//
// Section 77 fixes:
//   · Rate-limit tests reflect actual PRD caps: wikipedia = 300/min (5/s),
//     jina = 20/min, arxiv = 60/min. Paid pools have no per-minute cap.
//   · Monthly-cap tests use config overrides so they can hit the reserve
//     gate in a single day instead of needing ~28 days of drip-feed.
//   · Design-day test expands to a real 300 reserves (60 Light + 120
//     Standard + 120 Deep), matching the PRD 4.4 loop-cost table.

import { describe, it, expect } from 'vitest';
import {
  VerificationBroker,
  DEFAULT_POOLS,
  type PoolId,
} from '../src/broker.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0); // 2026-10-02 12:00 UTC (day 2 of month)
const DAY_MS = 24 * 60 * 60 * 1000;

function broker(now: () => number = () => T0): VerificationBroker {
  return new VerificationBroker({ now });
}

// =============================================================================
// Construction
// =============================================================================

describe('VerificationBroker — construction', () => {
  it('all 7 pools exist by default', () => {
    const b = broker();
    const ids = b.getStatus().map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        'arxiv',
        'exa',
        'gemini-grounding',
        'jina',
        'serper',
        'tavily',
        'wikipedia',
      ].sort(),
    );
  });

  it('DEFAULT_POOLS matches the PRD 4.3 / 8.5 table', () => {
    expect(DEFAULT_POOLS['gemini-grounding'].dailyCap).toBe(150);
    expect(DEFAULT_POOLS.tavily.dailyCap).toBe(25);
    expect(DEFAULT_POOLS.tavily.monthlyCap).toBe(1000);
    expect(DEFAULT_POOLS.tavily.monthlyReserve).toBe(300);
    expect(DEFAULT_POOLS.exa.dailyCap).toBe(25);
    expect(DEFAULT_POOLS.serper.oneTimeCap).toBe(2500);
    expect(DEFAULT_POOLS.serper.dailyCap).toBe(10);
    // PRD-accurate rate limits:
    expect(DEFAULT_POOLS.wikipedia.perMinuteCap).toBe(300); // 5/s × 60s
    expect(DEFAULT_POOLS.jina.perMinuteCap).toBe(20);
    expect(DEFAULT_POOLS.arxiv.perMinuteCap).toBe(60);
    // No per-minute caps on paid pools:
    expect(DEFAULT_POOLS['gemini-grounding'].perMinuteCap).toBeNull();
    expect(DEFAULT_POOLS.tavily.perMinuteCap).toBeNull();
    expect(DEFAULT_POOLS.exa.perMinuteCap).toBeNull();
    expect(DEFAULT_POOLS.serper.perMinuteCap).toBeNull();
    // Keyless pools have no daily cap:
    expect(DEFAULT_POOLS.wikipedia.dailyCap).toBeNull();
    expect(DEFAULT_POOLS.arxiv.dailyCap).toBeNull();
    expect(DEFAULT_POOLS.jina.dailyCap).toBeNull();
  });

  it('unknown pool is denied with reason=unknown_pool', () => {
    const b = broker();
    const out = b.reserve('nonexistent' as PoolId, 1, 'verify');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('unknown_pool');
  });
});

// =============================================================================
// Daily caps
// =============================================================================

describe('Daily caps', () => {
  it('gemini-grounding: 150/day, exactly 150 succeed, 151st denied', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) {
      const out = b.reserve('gemini-grounding', 1, 'verify', `c${i}`);
      expect(out.ok).toBe(true);
    }
    const denied = b.reserve('gemini-grounding', 1, 'verify', 'c150');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe('daily_exhausted');
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('tavily: 25/day enforced', () => {
    const b = broker();
    for (let i = 0; i < 25; i++) {
      expect(b.reserve('tavily', 1, 'verify').ok).toBe(true);
    }
    const denied = b.reserve('tavily', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('daily_exhausted');
  });

  it('keyless pools have no daily cap (wikipedia, arxiv, jina)', () => {
    const now = { t: T0 };
    const b = new VerificationBroker({ now: () => now.t });
    // wikipedia is 300/min → 5 bursts of 60 within a minute are fine
    for (let i = 0; i < 300; i++) expect(b.reserve('wikipedia', 1, 'verify').ok).toBe(true);
    now.t += 61_000;
    for (let i = 0; i < 300; i++) expect(b.reserve('wikipedia', 1, 'verify').ok).toBe(true);
    const status = b.getStatus().find((s) => s.id === 'wikipedia')!;
    expect(status.dailyCap).toBeNull();
    expect(status.usedToday).toBe(600);
  });
});

// =============================================================================
// Monthly caps
// =============================================================================

describe('Monthly caps', () => {
  it('tavily: effective monthly cap is (1000 - 300) = 700 before day 25', () => {
    // Override daily cap so we can hit the reserve gate in one shot.
    const b = new VerificationBroker({
      now: () => Date.UTC(2026, 9, 10, 12, 0, 0), // day 10, before 25
      config: { tavily: { dailyCap: 700 } },
    });
    let ok = 0;
    for (let i = 0; i < 800; i++) {
      if (b.reserve('tavily', 1, 'verify').ok) ok++;
    }
    expect(ok).toBe(700); // effective cap = 1000 - 300 = 700
  });

  it('tavily: after day 25, the 300-credit reserve unlocks', () => {
    const b = new VerificationBroker({
      now: () => Date.UTC(2026, 9, 26, 12, 0, 0), // day 26
      config: { tavily: { dailyCap: 1000 } },
    });
    let ok = 0;
    for (let i = 0; i < 1100; i++) {
      if (b.reserve('tavily', 1, 'verify').ok) ok++;
    }
    expect(ok).toBe(1000); // full cap unlocked on day 26+
  });
});

// =============================================================================
// One-time caps
// =============================================================================

describe('One-time caps', () => {
  it('serper: 2,500 lifetime, never resets', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    let burned = 0;
    for (let day = 0; day < 300 && burned < 2500; day++) {
      now = T0 + day * DAY_MS;
      for (let i = 0; i < 10 && burned < 2500; i++) {
        if (b.reserve('serper', 1, 'verify').ok) burned++;
      }
    }
    expect(burned).toBe(2500);
    now = T0 + 365 * DAY_MS;
    const denied = b.reserve('serper', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('one_time_exhausted');
  });

  it('serper: daily cap still applies (10/day)', () => {
    const b = broker();
    for (let i = 0; i < 10; i++) {
      expect(b.reserve('serper', 1, 'verify').ok).toBe(true);
    }
    const denied = b.reserve('serper', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('daily_exhausted');
  });
});

// =============================================================================
// Rate limits (per-minute)
// =============================================================================

describe('Rate limits (per-minute)', () => {
  it('wikipedia: 300/min (5/s × 60s), 301st in same minute is rate_limited', () => {
    const b = broker();
    for (let i = 0; i < 300; i++) {
      expect(b.reserve('wikipedia', 1, 'verify').ok).toBe(true);
    }
    const denied = b.reserve('wikipedia', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe('rate_limited');
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('wikipedia: after 60s, rate limit resets', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    for (let i = 0; i < 300; i++) expect(b.reserve('wikipedia', 1, 'verify').ok).toBe(true);
    now += 60_001;
    for (let i = 0; i < 300; i++) expect(b.reserve('wikipedia', 1, 'verify').ok).toBe(true);
    expect(b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday).toBe(600);
  });

  it('jina: 20/minute enforced', () => {
    const b = broker();
    for (let i = 0; i < 20; i++) expect(b.reserve('jina', 1, 'verify').ok).toBe(true);
    const denied = b.reserve('jina', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('rate_limited');
  });

  it('arxiv: 60/minute enforced (polite use)', () => {
    const b = broker();
    for (let i = 0; i < 60; i++) expect(b.reserve('arxiv', 1, 'verify').ok).toBe(true);
    const denied = b.reserve('arxiv', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('rate_limited');
  });

  it('gemini-grounding has no per-minute cap (verified: 150 burst all succeed)', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) {
      expect(b.reserve('gemini-grounding', 1, 'verify').ok).toBe(true);
    }
  });
});

// =============================================================================
// Reserve / commit / release
// =============================================================================

describe('Reserve / commit / release', () => {
  it('commit with actual < reserved refunds the difference', () => {
    const b = broker();
    const out = b.reserve('gemini-grounding', 1, 'verify');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    b.commit(out.token, 0);
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.usedToday).toBe(0);
  });

  it('commit with actual = reserved is a no-op', () => {
    const b = broker();
    const out = b.reserve('gemini-grounding', 1, 'verify');
    if (!out.ok) throw new Error('reserve failed');
    b.commit(out.token, 1);
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.usedToday).toBe(1);
  });

  it('release refunds fully', () => {
    const b = broker();
    const out = b.reserve('gemini-grounding', 1, 'verify');
    if (!out.ok) throw new Error('reserve failed');
    b.release(out.token);
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.usedToday).toBe(0);
  });

  it('commit with actual > reserved is clamped (no negative usage)', () => {
    const b = broker();
    const out = b.reserve('gemini-grounding', 1, 'verify');
    if (!out.ok) throw new Error('reserve failed');
    b.commit(out.token, 999);
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.usedToday).toBe(1);
  });
});

// =============================================================================
// 429 handling
// =============================================================================

describe('429 handling', () => {
  it('record429 blocks the pool until the retry window expires', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    b.record429('gemini-grounding', 30_000);
    const denied = b.reserve('gemini-grounding', 1, 'verify');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe('blocked_429');
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    }
    now += 30_001;
    expect(b.reserve('gemini-grounding', 1, 'verify').ok).toBe(true);
  });

  it('record429 takes the max of existing and new block', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    b.record429('tavily', 10_000);
    b.record429('tavily', 60_000);
    now += 30_000;
    const denied = b.reserve('tavily', 1, 'verify');
    expect(denied.ok).toBe(false);
  });
});

// =============================================================================
// Fallback chain
// =============================================================================

describe('Fallback chain', () => {
  it('getNextPool returns first available in preferred order', () => {
    const b = broker();
    const pool = b.getNextPool(
      ['gemini-grounding', 'tavily', 'exa', 'serper', 'wikipedia'],
      'verify',
    );
    expect(pool).toBe('gemini-grounding');
  });

  it('reserveWithFallback tries each pool until one succeeds', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    const out = b.reserveWithFallback(
      ['gemini-grounding', 'tavily', 'exa'],
      'verify',
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.token.pool).toBe('tavily');
  });

  it('reserveWithFallback returns all attempts when everything is exhausted', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('exa', 1, 'verify');
    const out = b.reserveWithFallback(
      ['gemini-grounding', 'tavily', 'exa'],
      'verify',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts.length).toBe(3);
      expect(out.attempts.map((a) => a.pool)).toEqual([
        'gemini-grounding',
        'tavily',
        'exa',
      ]);
    }
  });
});

// =============================================================================
// Purpose gating
// =============================================================================

describe('Purpose gating (FR-WF-03)', () => {
  it('gemini-grounding is NOT allowed for background', () => {
    const b = broker();
    const out = b.reserve('gemini-grounding', 1, 'background');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_allowed_for_purpose');
  });

  it('tavily, exa and serper are NOT allowed for background', () => {
    const b = broker();
    for (const pool of ['tavily', 'exa', 'serper'] as PoolId[]) {
      const out = b.reserve(pool, 1, 'background');
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('not_allowed_for_purpose');
    }
  });

  it('wikipedia, arxiv, jina ARE allowed for background', () => {
    const b = broker();
    for (const pool of ['wikipedia', 'arxiv', 'jina'] as PoolId[]) {
      const out = b.reserve(pool, 1, 'background');
      expect(out.ok).toBe(true);
    }
  });

  it('background is refused when interactive reserve < 30%', () => {
    const b = broker();
    // Burn 80%+ of each paid interactive pool
    for (let i = 0; i < 120; i++) b.reserve('gemini-grounding', 1, 'interactive');
    for (let i = 0; i < 20; i++) b.reserve('tavily', 1, 'interactive');
    for (let i = 0; i < 20; i++) b.reserve('exa', 1, 'interactive');
    for (let i = 0; i < 8; i++) b.reserve('serper', 1, 'interactive');
    // Interactive fraction = (30+5+5+2) / (150+25+25+10) = 42/210 = 20% < 30%
    const bgOut = b.reserve('wikipedia', 1, 'background');
    expect(bgOut.ok).toBe(false);
    if (!bgOut.ok) expect(bgOut.reason).toBe('background_reserve');
  });

  it('interactive purpose is always allowed until the pool itself is empty', () => {
    const b = broker();
    for (let i = 0; i < 149; i++) b.reserve('gemini-grounding', 1, 'interactive');
    expect(b.reserve('gemini-grounding', 1, 'interactive').ok).toBe(true);
  });
});

// =============================================================================
// Ledger
// =============================================================================

describe('Ledger', () => {
  it('every reserve writes exactly one row', () => {
    const b = broker();
    b.reserve('gemini-grounding', 1, 'verify', 'claim-1');
    b.reserve('tavily', 1, 'verify', 'claim-2');
    expect(b.getLedger().length).toBe(2);
    expect(b.getLedger()[0].result).toBe('ok');
    expect(b.getLedger()[0].claimId).toBe('claim-1');
  });

  it('denials write ledger rows too', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    b.reserve('gemini-grounding', 1, 'verify'); // denied
    const denied = b.getLedger().filter((r) => r.result === 'denied');
    expect(denied.length).toBe(1);
    expect(denied[0].reason).toBe('daily_exhausted');
  });

  it('ledger is append-only (never mutates past rows)', () => {
    const b = broker();
    b.reserve('gemini-grounding', 1, 'verify');
    const before = b.getLedger().slice();
    b.reserve('tavily', 1, 'verify');
    expect(before.length).toBe(1);
    expect(b.getLedger().length).toBe(2);
    expect(b.getLedger()[0]).toEqual(before[0]);
  });
});

// =============================================================================
// Reset behavior
// =============================================================================

describe('Reset behavior', () => {
  it('daily reset at UTC midnight', () => {
    let now = Date.UTC(2026, 9, 2, 23, 0, 0); // 1 hour before midnight
    const b = new VerificationBroker({ now: () => now });
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedToday).toBe(25);
    now = Date.UTC(2026, 9, 3, 0, 0, 1);
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedToday).toBe(0);
  });

  it('monthly reset at UTC month start', () => {
    let now = Date.UTC(2026, 9, 31, 22, 0, 0); // last day of October
    const b = new VerificationBroker({ now: () => now });
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedThisMonth).toBe(25);
    now = Date.UTC(2026, 10, 1, 0, 0, 1); // 1 Nov 2026
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedThisMonth).toBe(0);
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedEver).toBe(25);
  });
});

// =============================================================================
// getStatus (quota cockpit)
// =============================================================================

describe('getStatus — quota cockpit (Section 5.10)', () => {
  it('every pool has all required fields', () => {
    const b = broker();
    for (const s of b.getStatus()) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.displayName).toBe('string');
      expect(typeof s.usedToday).toBe('number');
      expect(typeof s.usedThisMonth).toBe('number');
      expect(typeof s.usedEver).toBe('number');
      expect(typeof s.resetsInMs).toBe('number');
      expect(s.percentUsed).toBeGreaterThanOrEqual(0);
      expect(s.percentUsed).toBeLessThanOrEqual(1);
    }
  });

  it('percentUsed reflects the tightest constraint', () => {
    const b = broker();
    for (let i = 0; i < 15; i++) b.reserve('gemini-grounding', 1, 'verify');
    const s = b.getStatus().find((x) => x.id === 'gemini-grounding')!;
    expect(s.percentUsed).toBeCloseTo(0.1, 2);
  });

  it('resetsInMs is positive when a cap is hit, 0 when fresh', () => {
    const b = broker();
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.resetsInMs).toBe(0);
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.resetsInMs).toBeGreaterThan(0);
  });
});

// =============================================================================
// T-29 — Capacity measurement
// =============================================================================

describe('T-29 — Capacity measurement (design day vs stress day)', () => {
  it('design day: 300 searches (60 Light ×1 + 30 Standard ×4 + 10 Deep ×12) fit', () => {
    const b = broker();

    // 60 Light turns — 1 search each, keyless-first
    for (let i = 0; i < 60; i++) {
      const out = b.reserveWithFallback(['wikipedia', 'arxiv'], 'verify');
      expect(out.ok).toBe(true);
    }

    // 30 Standard turns — 4 searches each (120 reserves)
    for (let i = 0; i < 30 * 4; i++) {
      const out = b.reserveWithFallback(
        ['wikipedia', 'gemini-grounding', 'tavily', 'exa'],
        'verify',
      );
      expect(out.ok).toBe(true);
    }

    // 10 Deep turns — 12 searches each (120 reserves)
    for (let i = 0; i < 10 * 12; i++) {
      const out = b.reserveWithFallback(
        ['gemini-grounding', 'tavily', 'exa', 'wikipedia'],
        'verify',
      );
      expect(out.ok).toBe(true);
    }

    const ledger = b.getLedger();
    expect(ledger.length).toBe(300);
    expect(ledger.every((r) => r.result === 'ok')).toBe(true);
  });

  it('stress day: 1000 searches exhausts all paid pools, remainder hits keyless limits', () => {
    const b = broker();
    let success = 0;
    let denied = 0;
    const order: PoolId[] = [
      'gemini-grounding',
      'tavily',
      'exa',
      'serper',
      'wikipedia',
      'arxiv',
    ];
    for (let i = 0; i < 1000; i++) {
      const out = b.reserveWithFallback(order, 'verify', 1, `stress-${i}`);
      if (out.ok) success++;
      else denied++;
    }
    // With 150+25+25+10 paid + 300 wiki + 60 arxiv = 570 max, 430+ denied
    expect(success).toBeLessThan(1000);
    expect(denied).toBeGreaterThan(0);
  });

  it('at least 210 paid searches succeed on a fresh broker (all pools combine)', () => {
    const b = broker();
    const counts: Record<string, number> = {
      'gemini-grounding': 0,
      tavily: 0,
      exa: 0,
      serper: 0,
    };
    for (const pool of ['gemini-grounding', 'tavily', 'exa', 'serper'] as PoolId[]) {
      while (true) {
        const out = b.reserve(pool, 1, 'verify');
        if (!out.ok) break;
        counts[pool]++;
      }
    }
    expect(counts['gemini-grounding']).toBe(150);
    expect(counts.tavily).toBe(25);
    expect(counts.exa).toBe(25);
    expect(counts.serper).toBe(10);
    const total = counts['gemini-grounding'] + counts.tavily + counts.exa + counts.serper;
    expect(total).toBe(210);
  });

  it('keyless pools provide the fallback when paid pools are exhausted', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('exa', 1, 'verify');
    for (let i = 0; i < 10; i++) b.reserve('serper', 1, 'verify');

    const out = b.reserveWithFallback(
      ['gemini-grounding', 'tavily', 'exa', 'serper', 'wikipedia'],
      'verify',
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.token.pool).toBe('wikipedia');
  });

  it('when all pools are dry, reserveWithFallback returns attempts (RECALL_ONLY signal)', () => {
    const b = broker();
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('exa', 1, 'verify');
    for (let i = 0; i < 10; i++) b.reserve('serper', 1, 'verify');
    for (let i = 0; i < 300; i++) b.reserve('wikipedia', 1, 'verify');
    for (let i = 0; i < 60; i++) b.reserve('arxiv', 1, 'verify');
    for (let i = 0; i < 20; i++) b.reserve('jina', 1, 'verify');

    const out = b.reserveWithFallback(
      [
        'gemini-grounding',
        'tavily',
        'exa',
        'serper',
        'wikipedia',
        'arxiv',
        'jina',
      ],
      'verify',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts.length).toBe(7);
      for (const a of out.attempts) {
        expect([
          'daily_exhausted',
          'monthly_exhausted',
          'one_time_exhausted',
          'rate_limited',
          'blocked_429',
        ]).toContain(a.reason);
      }
    }
  });
});

// =============================================================================
// Concurrency safety
// =============================================================================

describe('Concurrency safety', () => {
  it('1000 sequential reserves on gemini never exceed 150', () => {
    const b = broker();
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      if (b.reserve('gemini-grounding', 1, 'verify').ok) ok++;
    }
    expect(ok).toBe(150);
    expect(b.getStatus().find((s) => s.id === 'gemini-grounding')!.usedToday).toBe(150);
  });

  it('interleaved reserves on different pools track independently', () => {
    const b = broker();
    let g = 0;
    let t = 0;
    for (let i = 0; i < 20; i++) {
      if (b.reserve('gemini-grounding', 1, 'verify').ok) g++;
      if (b.reserve('tavily', 1, 'verify').ok) t++;
    }
    expect(g).toBe(20);
    expect(t).toBe(20);
    expect(b.getStatus().find((s) => s.id === 'tavily')!.usedToday).toBe(20);
  });
});
// === FILE END ===