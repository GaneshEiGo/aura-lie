// === FILE START ===
// packages/core-mode/test/orchestrator.test.ts
// Section 69 · PRD 7.8 · F-250 · FR-CORE-02/03/04/05.

import { describe, it, expect } from 'vitest';
import { CoreModeOrchestrator } from '../src/orchestrator.js';

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

describe('CoreModeOrchestrator.answer — full ladder', () => {
  it('routes a seeded question to cache', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('What is the capital of France?');
    expect(result.type).toBe('cache');
    expect(Array.isArray(result.text)).toBe(true);
    expect((result.text as string[]).some((s) => s.includes('Paris'))).toBe(true);
  });

  it('routes a math phrase to tool', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('calculate 15 * 3');
    expect(result.type).toBe('tool');
    expect(result.text).toBe('The result is 45.');
  });

  it('routes a date phrase to tool', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('what is the date 5 days from now?');
    expect(result.type).toBe('tool');
    expect(typeof result.text).toBe('string');
    expect((result.text as string).toLowerCase()).toContain('date');
  });

  it('routes an unknown query to promise', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(result.type).toBe('promise');
    expect(typeof result.text).toBe('string');
    expect((result.text as string).toLowerCase()).toContain('queued');
  });

  it('always records elapsedMs (>= 0)', () => {
    const { clock } = fixedClock(1_000);
    const orch = new CoreModeOrchestrator({ clock });
    const result = orch.answer('What is the capital of France?');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('exposes promiseId for promise-type results', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(result.type).toBe('promise');
    expect(result.promiseId).toBeTruthy();
    expect(typeof result.promiseId).toBe('string');
  });

  it('does not expose promiseId for non-promise results', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('What is the capital of France?');
    expect(result.type).toBe('cache');
    expect(result.promiseId).toBeUndefined();
  });
});

describe('CoreModeOrchestrator.banner — exact PRD copy', () => {
  const orch = new CoreModeOrchestrator();

  it('idle returns an empty message', () => {
    const b = orch.banner('idle');
    expect(b.state).toBe('idle');
    expect(b.message).toBe('');
  });

  it('core-mode matches PRD 5.13 verbatim', () => {
    const b = orch.banner('core-mode');
    expect(b.message).toBe(
      "Cloud models are resting until 05:30 IST. I can still search your notes, calculate and set reminders, and I'll answer when they're back.",
    );
  });

  it('offline matches PRD 5.13 verbatim', () => {
    const b = orch.banner('offline');
    expect(b.message).toBe("No internet. Showing what's on this device.");
  });

  it('quota-low matches PRD 5.13 verbatim', () => {
    const b = orch.banner('quota-low');
    expect(b.message).toBe(
      "The fast model is nearly used up today. I'll switch to the next one.",
    );
  });

  it('promise-queued matches PRD 5.13 verbatim', () => {
    const b = orch.banner('promise-queued');
    expect(b.message).toBe(
      "Queued. I'll answer when the models reset (about 3 h) and tell you.",
    );
  });
});

describe('CoreModeOrchestrator — pending + resolve', () => {
  it('hasPending is false on a fresh orchestrator', () => {
    const orch = new CoreModeOrchestrator();
    expect(orch.hasPending()).toBe(false);
  });

  it('hasPending becomes true after a promise-type answer', () => {
    const orch = new CoreModeOrchestrator();
    orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(orch.hasPending()).toBe(true);
  });

  it('pendingPromises lists FIFO order', () => {
    const { clock, advance } = fixedClock(1_000);
    const orch = new CoreModeOrchestrator({ clock });
    orch.answer('Write a 5000 word essay on the history of Rome.');
    advance(10);
    orch.answer('Write another 5000 word essay on the history of China.');
    const pending = orch.pendingPromises();
    expect(pending.length).toBe(2);
    expect(pending[0].query).toContain('Rome');
    expect(pending[1].query).toContain('China');
  });

  it('resolvePromise marks a kept promise', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    orch.resolvePromise(result.promiseId as string, true);
    expect(orch.keepRate()).toBe(1);
    expect(orch.hasPending()).toBe(false);
  });

  it('resolvePromise marks a broken promise', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    orch.resolvePromise(result.promiseId as string, false);
    expect(orch.keepRate()).toBe(0);
    expect(orch.hasPending()).toBe(false);
  });

  it('resolvePromise on an unknown id is a no-op', () => {
    const orch = new CoreModeOrchestrator();
    orch.resolvePromise('ghost', true);
    expect(orch.keepRate()).toBe(1);
    expect(orch.hasPending()).toBe(false);
  });
});

describe('CoreModeOrchestrator — keepRate + stats', () => {
  it('keepRate is 1 when nothing has been queued', () => {
    const orch = new CoreModeOrchestrator();
    expect(orch.keepRate()).toBe(1);
  });

  it('stats is empty on a fresh orchestrator', () => {
    const orch = new CoreModeOrchestrator();
    const s = orch.stats();
    expect(s.total).toBe(0);
    expect(s.pending).toBe(0);
    expect(s.kept).toBe(0);
    expect(s.broken).toBe(0);
    expect(s.keepRate).toBe(1);
  });

  it('stats reports one pending after enqueue', () => {
    const orch = new CoreModeOrchestrator();
    orch.answer('Write a 5000 word essay on the history of Rome.');
    const s = orch.stats();
    expect(s.total).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.kept).toBe(0);
    expect(s.broken).toBe(0);
  });

  it('stats reports kept after successful resume', () => {
    const orch = new CoreModeOrchestrator();
    const r = orch.answer('Write a 5000 word essay on the history of Rome.');
    orch.resolvePromise(r.promiseId as string, true);
    const s = orch.stats();
    expect(s.total).toBe(1);
    expect(s.pending).toBe(0);
    expect(s.kept).toBe(1);
    expect(s.broken).toBe(0);
    expect(s.keepRate).toBe(1);
  });

  it('stats reports broken after failed resume', () => {
    const orch = new CoreModeOrchestrator();
    const r = orch.answer('Write a 5000 word essay on the history of Rome.');
    orch.resolvePromise(r.promiseId as string, false);
    const s = orch.stats();
    expect(s.kept).toBe(0);
    expect(s.broken).toBe(1);
    expect(s.keepRate).toBe(0);
  });

  it('stats reports mixed kept + broken as 0.5', () => {
    const orch = new CoreModeOrchestrator();
    const a = orch.answer('Write a 5000 word essay on the history of Rome.');
    const b = orch.answer('Write a 5000 word essay on the history of China.');
    orch.resolvePromise(a.promiseId as string, true);
    orch.resolvePromise(b.promiseId as string, false);
    const s = orch.stats();
    expect(s.total).toBe(2);
    expect(s.pending).toBe(0);
    expect(s.kept).toBe(1);
    expect(s.broken).toBe(1);
    expect(s.keepRate).toBe(0.5);
  });

  it('T-28: 10 promises, 10 kept -> keepRate 1.0', () => {
    const orch = new CoreModeOrchestrator();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = orch.answer(`Write a long essay ${i} on something obscure.`);
      ids.push(r.promiseId as string);
    }
    for (const id of ids) orch.resolvePromise(id, true);
    const s = orch.stats();
    expect(s.total).toBe(10);
    expect(s.kept).toBe(10);
    expect(s.broken).toBe(0);
    expect(s.keepRate).toBe(1);
  });
});

describe('CoreModeOrchestrator — clear', () => {
  it('clear empties the queue', () => {
    const orch = new CoreModeOrchestrator();
    orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(orch.hasPending()).toBe(true);
    orch.clear();
    expect(orch.hasPending()).toBe(false);
    expect(orch.stats().total).toBe(0);
  });
});
// === FILE END ===