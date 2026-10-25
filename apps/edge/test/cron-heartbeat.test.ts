// === FILE START ===
// apps/edge/test/cron-heartbeat.test.ts
// Section 69 · PRD 10.4 · FR-CORE-04/06.
// Uses an inline fake queue — no dependency on @aura-lie/core-mode.

import { describe, it, expect } from 'vitest';
import { runHeartbeat } from '../src/cron/heartbeat.js';
import type { CronQueueLike } from '../src/cron/heartbeat.js';

interface FakePromise {
  id: string;
  query: string;
  status: 'pending' | 'kept' | 'broken';
}

function makeFakeQueue(initial: string[] = []): CronQueueLike & {
  fake: FakePromise[];
  enqueue: (q: string) => string;
} {
  const fake: FakePromise[] = initial.map((q, i) => ({
    id: `p${i + 1}`,
    query: q,
    status: 'pending',
  }));
  let counter = initial.length;

  return {
    fake,
    enqueue: (q: string) => {
      counter += 1;
      const id = `p${counter}`;
      fake.push({ id, query: q, status: 'pending' });
      return id;
    },
    pending: () =>
      fake
        .filter((p) => p.status === 'pending')
        .map((p) => ({ id: p.id, query: p.query })),
    resumeOne: (id, answer) => {
      const p = fake.find((x) => x.id === id);
      if (!p || p.status !== 'pending') return;
      p.status = answer === null ? 'broken' : 'kept';
    },
    stats: () => {
      const total = fake.length;
      const pending = fake.filter((p) => p.status === 'pending').length;
      const resolved = total - pending;
      const kept = fake.filter((p) => p.status === 'kept').length;
      const broken = fake.filter((p) => p.status === 'broken').length;
      return {
        total,
        pending,
        kept,
        broken,
        keepRate: resolved === 0 ? 1 : kept / resolved,
      };
    },
  };
}

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

describe('runHeartbeat — empty + kill switch', () => {
  it('empty queue: ran=true, skipped=true, reason=empty-queue', () => {
    const queue = makeFakeQueue();
    const result = runHeartbeat(queue);
    expect(result.ran).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('empty-queue');
    expect(result.resolved).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('kill switch stops everything', () => {
    const queue = makeFakeQueue(['q1', 'q2']);
    const result = runHeartbeat(queue, { killSwitch: () => true });
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('kill-switch');
    expect(queue.pending().length).toBe(2);
  });
});

describe('runHeartbeat — resolution', () => {
  it('resolves all pending in FIFO order', () => {
    const queue = makeFakeQueue(['first', 'second', 'third']);
    const order: string[] = [];
    const result = runHeartbeat(queue, {
      resolver: (q) => {
        order.push(q);
        return 'answer';
      },
    });
    expect(order).toEqual(['first', 'second', 'third']);
    expect(result.kept).toBe(3);
    expect(result.broken).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('resolver returning null -> broken', () => {
    const queue = makeFakeQueue(['a', 'b']);
    const result = runHeartbeat(queue, {
      resolver: (q) => (q === 'a' ? 'ok' : null),
    });
    expect(result.kept).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.keepRate).toBe(0.5);
  });

  it('honours maxResolvePerTick', () => {
    const queue = makeFakeQueue(['a', 'b', 'c', 'd', 'e']);
    const result = runHeartbeat(queue, {
      resolver: () => 'ok',
      maxResolvePerTick: 2,
    });
    expect(result.resolved).toBe(2);
    expect(result.pending).toBe(3);
  });

  it('second tick is a no-op after full resolution', () => {
    const queue = makeFakeQueue(['a']);
    runHeartbeat(queue, { resolver: () => 'ok' });
    const second = runHeartbeat(queue, { resolver: () => 'ok' });
    expect(second.resolved).toBe(0);
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('empty-queue');
  });
});

describe('runHeartbeat — notifications', () => {
  it('fires one notification per resolved promise', () => {
    const queue = makeFakeQueue(['a', 'b']);
    const fired: Array<{ id: string; success: boolean }> = [];
    runHeartbeat(queue, {
      resolver: () => 'ok',
      notifier: (n) => fired.push({ id: n.promiseId, success: n.success }),
    });
    expect(fired.length).toBe(2);
    expect(fired.every((f) => f.success)).toBe(true);
  });

  it('fires a broken notification when resolver returns null', () => {
    const queue = makeFakeQueue(['a']);
    const fired: Array<{ success: boolean; hasAnswer: boolean }> = [];
    runHeartbeat(queue, {
      resolver: () => null,
      notifier: (n) =>
        fired.push({ success: n.success, hasAnswer: n.answer !== undefined }),
    });
    expect(fired.length).toBe(1);
    expect(fired[0].success).toBe(false);
    expect(fired[0].hasAnswer).toBe(false);
  });
});

describe('runHeartbeat — timing', () => {
  it('records elapsedMs (>= 0)', () => {
    const { clock } = fixedClock(1_000);
    const queue = makeFakeQueue(['a']);
    const result = runHeartbeat(queue, { clock, resolver: () => 'ok' });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('runHeartbeat — T-28 acceptance', () => {
  it('T-28: 15 promises, all kept -> keepRate 1.0', () => {
    const queue = makeFakeQueue(Array.from({ length: 15 }, (_, i) => `q${i}`));
    const result = runHeartbeat(queue, { resolver: () => 'ok' });
    expect(result.kept).toBe(15);
    expect(result.broken).toBe(0);
    expect(result.keepRate).toBe(1);
  });
});
// === FILE END ===