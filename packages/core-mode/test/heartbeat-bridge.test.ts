// === FILE START ===
// packages/core-mode/test/heartbeat-bridge.test.ts
// Section 69 · PRD 10.4 · 13.7 · FR-CORE-04/06 · T-28.

import { describe, it, expect } from 'vitest';
import { PromiseQueue } from '../src/promise-queue.js';
import { HeartbeatBridge, adaptPromiseStore } from '../src/heartbeat-bridge.js';
import type { PromiseStoreLike } from '../src/heartbeat-bridge.js';

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

describe('HeartbeatBridge — empty + skip', () => {
  it('empty queue: ran=true, resolved=0, keepRate=1', () => {
    const queue = new PromiseQueue<string>();
    const bridge = new HeartbeatBridge(queue);
    const result = bridge.tick();
    expect(result.ran).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('empty-queue');
    expect(result.resolved).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('kill switch on: ran=false, skipped=true, reason=kill-switch', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, { killSwitch: () => true });
    const result = bridge.tick();
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('kill-switch');
    expect(queue.pending().length).toBe(1);
  });
});

describe('HeartbeatBridge — resolution', () => {
  it('resolves one promise', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, {
      resolver: (q) => 'answer-' + q,
    });
    const result = bridge.tick();
    expect(result.ran).toBe(true);
    expect(result.resolved).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.broken).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('preserves FIFO order', () => {
    const { clock, advance } = fixedClock(1_000);
    const queue = new PromiseQueue<string>({ clock });
    queue.enqueue('first', { reason: 'test' });
    advance(10);
    queue.enqueue('second', { reason: 'test' });
    advance(10);
    queue.enqueue('third', { reason: 'test' });

    const order: string[] = [];
    const bridge = new HeartbeatBridge(queue, {
      resolver: (q) => {
        order.push(q);
        return 'ok';
      },
    });
    bridge.tick();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('resolver returning null marks the promise broken', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    queue.enqueue('b', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, {
      resolver: (q) => (q === 'a' ? 'ok' : null),
    });
    const result = bridge.tick();
    expect(result.kept).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.keepRate).toBe(0.5);
  });

  it('second tick after full resolution is a no-op', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, { resolver: () => 'ok' });
    bridge.tick();
    const r2 = bridge.tick();
    expect(r2.resolved).toBe(0);
    expect(r2.pending).toBe(0);
    expect(r2.keepRate).toBe(1);
  });

  it('honours maxResolvePerTick', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    queue.enqueue('b', { reason: 'test' });
    queue.enqueue('c', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, {
      resolver: () => 'ok',
      maxResolvePerTick: 2,
    });
    const result = bridge.tick();
    expect(result.resolved).toBe(2);
    expect(result.pending).toBe(1);
  });
});

describe('HeartbeatBridge — notifications', () => {
  it('fires notifications for each resolved promise', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    queue.enqueue('b', { reason: 'test' });
    const fired: Array<{ id: string; success: boolean }> = [];
    const bridge = new HeartbeatBridge(queue, {
      resolver: () => 'ok',
      notifier: (n) => fired.push({ id: n.promiseId, success: n.success }),
    });
    bridge.tick();
    expect(fired.length).toBe(2);
    expect(fired.every((f) => f.success)).toBe(true);
  });

  it('fires a notification for a broken promise', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('a', { reason: 'test' });
    const fired: Array<{ success: boolean; hasAnswer: boolean }> = [];
    const bridge = new HeartbeatBridge(queue, {
      resolver: () => null,
      notifier: (n) =>
        fired.push({ success: n.success, hasAnswer: n.answer !== undefined }),
    });
    bridge.tick();
    expect(fired.length).toBe(1);
    expect(fired[0].success).toBe(false);
    expect(fired[0].hasAnswer).toBe(false);
  });

  it('notification includes the original query', () => {
    const queue = new PromiseQueue<string>();
    queue.enqueue('Write an essay', { reason: 'test' });
    const queries: string[] = [];
    const bridge = new HeartbeatBridge(queue, {
      resolver: () => 'ok',
      notifier: (n) => queries.push(n.query),
    });
    bridge.tick();
    expect(queries).toEqual(['Write an essay']);
  });
});

describe('HeartbeatBridge — timing', () => {
  it('records elapsedMs (>= 0)', () => {
    const { clock } = fixedClock(1_000);
    const queue = new PromiseQueue<string>({ clock });
    queue.enqueue('a', { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, { clock, resolver: () => 'ok' });
    const result = bridge.tick();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('adaptPromiseStore — engine PromiseStore adapter', () => {
  it('adapts a PromiseStore-like object into a QueueLike', () => {
    const entries = [
      { id: 'p1', query: 'q1', status: 'queued' as 'queued' | 'resolved' | 'broken' },
      { id: 'p2', query: 'q2', status: 'queued' as 'queued' | 'resolved' | 'broken' },
    ];
    const store: PromiseStoreLike = {
      getPending: () =>
        entries
          .filter((e) => e.status === 'queued')
          .map((e) => ({ id: e.id, query: e.query })),
      resume: (id, success) => {
        const e = entries.find((x) => x.id === id);
        if (e) e.status = success ? 'resolved' : 'broken';
      },
      size: () => entries.length,
      getKeepRate: () => {
        const resolved = entries.filter((e) => e.status !== 'queued');
        if (resolved.length === 0) return 100;
        const kept = resolved.filter((e) => e.status === 'resolved').length;
        return (kept / resolved.length) * 100;
      },
    };

    const queue = adaptPromiseStore(store);
    expect(queue.pending().length).toBe(2);

    const bridge = new HeartbeatBridge(queue, { resolver: () => 'ok' });
    const result = bridge.tick();
    expect(result.kept).toBe(2);
    expect(result.pending).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('adapter honours kill switch through the bridge', () => {
    const store: PromiseStoreLike = {
      getPending: () => [{ id: 'p1', query: 'q1' }],
      resume: () => {},
      size: () => 1,
      getKeepRate: () => 100,
    };
    const queue = adaptPromiseStore(store);
    const bridge = new HeartbeatBridge(queue, { killSwitch: () => true });
    const result = bridge.tick();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('kill-switch');
  });
});

describe('HeartbeatBridge — T-28 acceptance', () => {
  it('T-28: 20 promises, all kept -> keepRate 1.0', () => {
    const queue = new PromiseQueue<string>();
    for (let i = 0; i < 20; i++) queue.enqueue(`q${i}`, { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, { resolver: () => 'answer' });
    const result = bridge.tick();
    expect(result.kept).toBe(20);
    expect(result.broken).toBe(0);
    expect(result.keepRate).toBe(1);
  });

  it('T-28: 20 promises across two ticks -> still keepRate 1.0', () => {
    const queue = new PromiseQueue<string>();
    for (let i = 0; i < 20; i++) queue.enqueue(`q${i}`, { reason: 'test' });
    const bridge = new HeartbeatBridge(queue, {
      resolver: () => 'answer',
      maxResolvePerTick: 10,
    });
    const r1 = bridge.tick();
    expect(r1.resolved).toBe(10);
    expect(r1.pending).toBe(10);
    const r2 = bridge.tick();
    expect(r2.resolved).toBe(10);
    expect(r2.pending).toBe(0);
    expect(r2.keepRate).toBe(1);
  });
});
// === FILE END ===