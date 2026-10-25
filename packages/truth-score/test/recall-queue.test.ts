// === FILE START ===
// packages/truth-score/test/recall-queue.test.ts
// PRD 8.5 "Verify later" — 100% promise-keep.
//
// The RecallQueue holds deferred claims until their retryAt has passed.
// Every drained claim is re-run through verifyClaim — no losses, no
// duplicates, no reordering within the same retryAt.

import { describe, it, expect } from 'vitest';
import { RecallQueue, type DeferredItem } from '../src/recall-queue.js';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function item(
  claimId: string,
  retryAt: number,
  overrides: Partial<DeferredItem> = {},
): DeferredItem {
  return {
    claimId,
    claim: {
      claimId,
      text: `Claim ${claimId}`,
      checkable: true,
      checked: true,
      volatility: 'stable',
    },
    sources: [],
    importance: 0.5,
    queuedAt: T0,
    retryAt,
    reason: 'quota',
    ...overrides,
  };
}

describe('RecallQueue — basic operations', () => {
  it('enqueue + size', () => {
    const q = new RecallQueue();
    expect(q.size()).toBe(0);
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    expect(q.size()).toBe(2);
  });

  it('peek returns first without removing', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    expect(q.peek()!.claimId).toBe('a');
    expect(q.size()).toBe(2);
  });

  it('peek on empty returns null', () => {
    const q = new RecallQueue();
    expect(q.peek()).toBeNull();
  });

  it('clear empties the queue', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.peek()).toBeNull();
  });

  it('enqueue rejects negative retryAt', () => {
    const q = new RecallQueue();
    expect(() => q.enqueue(item('a', -1))).toThrow(/retryAt/);
  });
});

describe('RecallQueue — drain', () => {
  it('drain at T0 with all items pending returns []', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    expect(q.drain(T0)).toEqual([]);
    expect(q.size()).toBe(2);
  });

  it('drain at T0+MIN returns the one item that is ready', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    const ready = q.drain(T0 + MIN);
    expect(ready.length).toBe(1);
    expect(ready[0].claimId).toBe('a');
    expect(q.size()).toBe(1);
    expect(q.peek()!.claimId).toBe('b');
  });

  it('drain at T0+2*MIN returns both remaining items', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    q.drain(T0 + MIN); // remove a
    const ready = q.drain(T0 + 2 * MIN);
    expect(ready.map((i) => i.claimId)).toEqual(['b']);
  });

  it('drain preserves insertion order for equal retryAt', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + MIN));
    q.enqueue(item('c', T0 + MIN));
    const ready = q.drain(T0 + MIN);
    expect(ready.map((i) => i.claimId)).toEqual(['a', 'b', 'c']);
  });

  it('drain preserves insertion order across mixed retryAt', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    q.enqueue(item('c', T0 + MIN));
    const ready = q.drain(T0 + 2 * MIN);
    // Order must be insertion order: a, b, c (not sorted by retryAt).
    expect(ready.map((i) => i.claimId)).toEqual(['a', 'b', 'c']);
  });

  it('drain at Infinity-boundary — items with retryAt=Infinity never auto-drain', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', Infinity, { reason: 'all_pools_dry' }));
    const ready = q.drain(T0 + 3 * MIN);
    // Only 'a' comes out; 'b' stays.
    expect(ready.map((i) => i.claimId)).toEqual(['a']);
    expect(q.size()).toBe(1);
    expect(q.peek()!.claimId).toBe('b');
  });
});

describe('RecallQueue — takeByClaimId (manual "Verify now")', () => {
  it('removes the specific item and returns it', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    const taken = q.takeByClaimId('b');
    expect(taken).not.toBeNull();
    expect(taken!.claimId).toBe('b');
    expect(q.size()).toBe(1);
    expect(q.peek()!.claimId).toBe('a');
  });

  it('returns null for unknown claimId', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    expect(q.takeByClaimId('nonexistent')).toBeNull();
    expect(q.size()).toBe(1);
  });

  it('can take an all_pools_dry item for manual retry', () => {
    const q = new RecallQueue();
    q.enqueue(item('dry', Infinity, { reason: 'all_pools_dry' }));
    const taken = q.takeByClaimId('dry');
    expect(taken).not.toBeNull();
    expect(taken!.reason).toBe('all_pools_dry');
    expect(q.size()).toBe(0);
  });
});

describe('RecallQueue — all()', () => {
  it('returns a read-only view without removing', () => {
    const q = new RecallQueue();
    q.enqueue(item('a', T0 + MIN));
    q.enqueue(item('b', T0 + 2 * MIN));
    const view = q.all();
    expect(view.length).toBe(2);
    expect(view.map((i) => i.claimId)).toEqual(['a', 'b']);
    expect(q.size()).toBe(2);
  });
});

describe('RecallQueue — end-to-end promise-keep', () => {
  it('10 deferred claims drain in the right order at the right time', () => {
    const q = new RecallQueue();
    // 5 due at +1m, 5 due at +2m, interleaved insertion.
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      q.enqueue(item(`fast-${i}`, T0 + MIN));
      order.push(`fast-${i}`);
      q.enqueue(item(`slow-${i}`, T0 + 2 * MIN));
      order.push(`slow-${i}`);
    }
    expect(q.size()).toBe(10);

    // First drain at +1m returns all fast-*, in insertion order.
    const first = q.drain(T0 + MIN);
    expect(first.map((i) => i.claimId)).toEqual([
      'fast-0',
      'fast-1',
      'fast-2',
      'fast-3',
      'fast-4',
    ]);
    expect(q.size()).toBe(5);

    // Second drain at +2m returns all slow-*.
    const second = q.drain(T0 + 2 * MIN);
    expect(second.map((i) => i.claimId)).toEqual([
      'slow-0',
      'slow-1',
      'slow-2',
      'slow-3',
      'slow-4',
    ]);
    expect(q.size()).toBe(0);
  });
});
// === FILE END ===