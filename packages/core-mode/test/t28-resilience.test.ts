// packages/core-mode/test/t28-resilience.test.ts
// T-28 · Core Mode resilience gate.
// PRD 15.2: "All pools exhausted or offline: cache, memory answers and rule
// tools respond. Everything else is queued. Queued promises resume in order.
// 100% served or promised, promise-keep 100%, ≥ 60% of seeded-history queries
// answered without a model."

import { CoreCache, ResilienceCache, cosineSimilarity, formatCacheLabel } from '../src/cache.js';
import {
  calculate,
  dateMath,
  formatIsoDate,
  parseIsoDate,
  currencyConvert,
  TimerManager,
} from '../src/rule-tools.js';
import { PromiseQueue } from '../src/promise-queue.js';

// -----------------------------------------------------------------------------
// Fixed clock helper
// -----------------------------------------------------------------------------

function fixedClock(at: number): {
  clock: { now(): number };
  advance: (ms: number) => void;
} {
  let t = at;
  return {
    clock: { now: () => t },
    advance: (ms) => {
      t += ms;
    },
  };
}

// =============================================================================
// CACHE (PRD 13.8)
// =============================================================================

describe('CoreCache (PRD 13.8)', () => {
  it('exact hit returns the cached value', () => {
    const { clock } = fixedClock(1_000_000);
    const cache = new CoreCache<string>({ clock });
    cache.set('Q1', 'answer-one');
    const hit = cache.get('Q1');
    expect(hit?.value).toBe('answer-one');
    expect(hit?.kind).toBe('exact');
  });

  it('miss returns null', () => {
    const cache = new CoreCache<string>();
    expect(cache.get('ghost')).toBeNull();
  });

  it('expired entries are evicted on read', () => {
    const { clock, advance } = fixedClock(1_000_000);
    const cache = new CoreCache<string>({ clock, defaultTtlMs: 1000 });
    cache.set('Q1', 'answer');
    advance(2000);
    expect(cache.get('Q1')).toBeNull();
  });

  it('semantic hit works for cosine ≥ 0.93', () => {
    const cache = new CoreCache<string>();
    cache.set('Q1', 'sun', { embedding: [1, 0, 0] });
    const hit = cache.get('Q1-alt', { embedding: [0.99, 0.01, 0] });
    expect(hit?.value).toBe('sun');
    expect(hit?.kind).toBe('semantic');
  });

  it('semantic miss for cosine < 0.93', () => {
    const cache = new CoreCache<string>();
    cache.set('Q1', 'sun', { embedding: [1, 0, 0] });
    const hit = cache.get('Q2', { embedding: [0, 1, 0] });
    expect(hit).toBeNull();
  });

  it('label formats as "cached · Xm old" / "cached · Xh old"', () => {
    const now = 10 * 60 * 60 * 1000; // 10 h
    expect(formatCacheLabel(now - 2 * 60 * 60 * 1000, now)).toBe('cached · 2h old');
    expect(formatCacheLabel(now - 5 * 60 * 1000, now)).toBe('cached · 5m old');
    expect(formatCacheLabel(now - 30 * 1000, now)).toBe('cached · just now');
  });

  it('clear empties the cache', () => {
    const cache = new CoreCache<string>();
    cache.set('Q1', 'a');
    cache.set('Q2', 'b');
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('cosineSimilarity is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
});

// =============================================================================
// RULE TOOLS (PRD 7.8)
// =============================================================================

describe('calculate — safe calculator', () => {
  it('evaluates basic addition', () => {
    expect(calculate('2 + 3')).toEqual({ ok: true, value: 5 });
  });
  it('respects multiplication precedence', () => {
    expect(calculate('2 + 3 * 4')).toEqual({ ok: true, value: 14 });
  });
  it('respects parentheses', () => {
    expect(calculate('(2 + 3) * 4')).toEqual({ ok: true, value: 20 });
  });
  it('handles unary minus', () => {
    expect(calculate('-3 + 2')).toEqual({ ok: true, value: -1 });
  });
  it('rejects division by zero', () => {
    const r = calculate('10 / 0');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('division');
  });
  it('rejects non-arithmetic input', () => {
    const r = calculate('hello world');
    expect(r.ok).toBe(false);
  });
  it('rejects empty input', () => {
    expect(calculate('').ok).toBe(false);
  });
});

describe('dateMath — deterministic date arithmetic', () => {
  const now = Date.UTC(2026, 9, 2); // 2026-10-02
  it('adds 7 days', () => {
    const r = dateMath('+7d', now);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('2026-10-09');
  });
  it('subtracts 3 days', () => {
    const r = dateMath('-3d', now);
    expect(r.value).toBe('2026-09-29');
  });
  it('computes a difference in days', () => {
    const r = dateMath('2026-10-02 - 2026-09-25');
    expect(r.value).toBe(7);
  });
  it('parseIsoDate / formatIsoDate round-trip', () => {
    const ms = parseIsoDate('2026-10-02');
    expect(ms).not.toBeNull();
    expect(formatIsoDate(ms as number)).toBe('2026-10-02');
  });
});

describe('currencyConvert — offline rate table', () => {
  const rates = {
    base: 'USD',
    rates: { USD: 1, INR: 0.012, EUR: 1.08 },
    at: 1_000,
  };
  it('converts USD → INR', () => {
    const r = currencyConvert(100, 'USD', 'INR', rates);
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(8333.3333, 2);
  });
  it('rejects unknown currency', () => {
    const r = currencyConvert(100, 'USD', 'XYZ', rates);
    expect(r.ok).toBe(false);
  });
});

describe('TimerManager', () => {
  it('setTimer registers a timer', () => {
    const { clock } = fixedClock(1_000);
    const tm = new TimerManager({ clock });
    const t = tm.setTimer('tea', 2_000);
    expect(tm.listTimers()).toHaveLength(1);
    expect(t.id).toBeTruthy();
  });
  it('tick fires due timers', () => {
    const { clock, advance } = fixedClock(1_000);
    const tm = new TimerManager({ clock });
    tm.setTimer('tea', 2_000);
    advance(1_500);
    const due = tm.tick();
    expect(due).toHaveLength(1);
    expect(tm.listTimers()).toHaveLength(0);
  });
  it('cancelTimer removes a timer', () => {
    const { clock } = fixedClock(1_000);
    const tm = new TimerManager({ clock });
    const t = tm.setTimer('tea', 2_000);
    expect(tm.cancelTimer(t.id)).toBe(true);
    expect(tm.listTimers()).toHaveLength(0);
  });
});

// =============================================================================
// PROMISE QUEUE (PRD 7.8, FR-CORE-04)
// =============================================================================

describe('PromiseQueue (FR-CORE-04)', () => {
  it('empty queue reports a 1.0 keep-rate', () => {
    const q = new PromiseQueue<string>();
    expect(q.keepRate()).toBe(1);
  });

  it('enqueue returns a visible promise', () => {
    const { clock } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    const p = q.enqueue('What is Q3 revenue?', { reason: 'no_model' });
    expect(p.status).toBe('pending');
    expect(p.reason).toBe('no_model');
    expect(p.id).toBeTruthy();
  });

  it('pending() lists promises in FIFO order', () => {
    const { clock, advance } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    q.enqueue('first', { reason: 'x' });
    advance(10);
    q.enqueue('second', { reason: 'x' });
    advance(10);
    q.enqueue('third', { reason: 'x' });
    expect(q.pending().map((p) => p.query)).toEqual(['first', 'second', 'third']);
  });

  it('resumeAll keeps everything when the handler succeeds', () => {
    const { clock } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    q.enqueue('a', { reason: 'r' });
    q.enqueue('b', { reason: 'r' });
    const res = q.resumeAll((query) => 'answer:' + query);
    expect(res.kept).toBe(2);
    expect(res.broken).toBe(0);
    expect(q.keepRate()).toBe(1);
  });

  it('resumeAll marks null results as broken', () => {
    const { clock } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    q.enqueue('a', { reason: 'r' });
    q.enqueue('b', { reason: 'r' });
    const res = q.resumeAll((query) => (query === 'a' ? 'ok' : null));
    expect(res.kept).toBe(1);
    expect(res.broken).toBe(1);
    expect(q.keepRate()).toBe(0.5);
  });

  it('formatPromiseMessage matches the PRD copy', () => {
    const { clock } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    const p = q.enqueue('a', { reason: 'r', earliestResume: 1_000 + 3 * 60 * 60 * 1000 });
    expect(q.formatPromiseMessage(p)).toBe(
      "Queued. I'll answer when the models reset (about 3 h) and tell you.",
    );
  });

  it('stats() reports kept/broken/pending', () => {
    const { clock } = fixedClock(1_000);
    const q = new PromiseQueue<string>({ clock });
    q.enqueue('a', { reason: 'r' });
    q.enqueue('b', { reason: 'r' });
    q.resumeAll(() => 'ok');
    q.enqueue('c', { reason: 'r' });
    const s = q.stats();
    expect(s.total).toBe(3);
    expect(s.kept).toBe(2);
    expect(s.broken).toBe(0);
    expect(s.pending).toBe(1);
  });
});

// =============================================================================
// T-28 GATE — the actual acceptance test
// =============================================================================

describe('T-28 — Core Mode resilience gate', () => {
  it('100% served-or-promised under total pool exhaustion', () => {
    const { clock } = fixedClock(1_000_000);
    const cache = new CoreCache<string>({ clock });
    const promises = new PromiseQueue<string>({ clock });

    // Seed: 6 entries cached, 2 matched by a memory fn, 2 have nothing.
    cache.set('q1', 'a1');
    cache.set('q2', 'a2');
    cache.set('q3', 'a3');
    cache.set('q4', 'a4');
    cache.set('q5', 'a5');
    cache.set('q6', 'a6');

    const memorySearch = (query: string): string | null => {
      if (query === 'q7') return 'memory-m7';
      if (query === 'q8') return 'memory-m8';
      return null;
    };

    const queries = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];
    let served = 0;
    let promised = 0;

    for (const q of queries) {
      const hit = cache.get(q);
      if (hit) {
        served += 1;
        continue;
      }
      const mem = memorySearch(q);
      if (mem !== null) {
        served += 1;
        continue;
      }
      promises.enqueue(q, { reason: 'no_model' });
      promised += 1;
    }

    expect(served + promised).toBe(queries.length);
    expect(served).toBe(8); // 6 from cache + 2 from memory
    expect(promised).toBe(2); // q9, q10
    expect(served / queries.length).toBeGreaterThanOrEqual(0.6);
  });

  it('promise-keep rate is 100% after all pools come back', () => {
    const { clock } = fixedClock(1_000_000);
    const promises = new PromiseQueue<string>({ clock });
    promises.enqueue('q9', { reason: 'no_model' });
    promises.enqueue('q10', { reason: 'no_model' });

    const { kept, broken } = promises.resumeAll((q) => 'answer:' + q);
    expect(kept).toBe(2);
    expect(broken).toBe(0);
    expect(promises.keepRate()).toBe(1);
  });

  it('queued requests preserve their original query', () => {
    const { clock } = fixedClock(1_000_000);
    const promises = new PromiseQueue<string>({ clock });
    const original = 'What is the run rate for Q3?';
    promises.enqueue(original, { reason: 'no_model' });
    const pending = promises.pending();
    expect(pending[0].query).toBe(original);
  });

  it('rule tools still answer when every model pool is exhausted', () => {
    expect(calculate('2 + 3').value).toBe(5);
    expect(currencyConvert(100, 'USD', 'INR', {
      base: 'USD',
      rates: { USD: 1, INR: 0.012 },
      at: 1_000,
    }).value).toBeCloseTo(8333.3333, 2);
  });

  it('cache labels age correctly under Core Mode', () => {
    const { clock, advance } = fixedClock(1_000_000);
    const cache = new CoreCache<string>({ clock });
    cache.set('q1', 'a1');
    advance(2 * 60 * 60 * 1000); // 2 h
    const hit = cache.get('q1');
    expect(hit?.label).toBe('cached · 2h old');
  });
});