// === FILE START ===
// packages/agents/test/replay-v2.test.ts
// PRD §10.9 · F-098.

import { describe, it, expect } from 'vitest';
import {
  validateTrace,
  replayTrace,
  diffTraces,
  type TraceEvent,
} from '../src/replay-v2.js';

function ev(seq: number, ts: number, kind: string, description: string): TraceEvent {
  return { seq, timestampMs: ts, kind, description };
}

const CLEAN_TRACE: readonly TraceEvent[] = [
  ev(1, 1000, 'plan', 'Plan decided'),
  ev(2, 2000, 'search', 'Searching Wikipedia'),
  ev(3, 3000, 'verify', 'Verified claim 1'),
  ev(4, 4000, 'synthesise', 'Synthesised answer'),
  ev(5, 5000, 'done', 'Done'),
];

describe('replay — validateTrace', () => {
  it('accepts a clean monotonic trace', () => {
    expect(validateTrace(CLEAN_TRACE)).toEqual({ ok: true, errors: [] });
  });

  it('accepts an empty trace', () => {
    expect(validateTrace([])).toEqual({ ok: true, errors: [] });
  });

  it('rejects non-strictly-increasing seq', () => {
    const bad: TraceEvent[] = [
      ev(1, 1000, 'plan', 'a'),
      ev(1, 2000, 'search', 'b'),
    ];
    const r = validateTrace(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('seq'))).toBe(true);
  });

  it('rejects timestamps that go backwards', () => {
    const bad: TraceEvent[] = [
      ev(1, 2000, 'plan', 'a'),
      ev(2, 1000, 'search', 'b'),
    ];
    const r = validateTrace(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('timestamp'))).toBe(true);
  });

  it('rejects an event with an empty kind', () => {
    const bad: TraceEvent[] = [ev(1, 1000, '', 'a')];
    const r = validateTrace(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('kind'))).toBe(true);
  });
});

describe('replay — replayTrace', () => {
  it('returns events sorted by seq', () => {
    const unordered: TraceEvent[] = [...CLEAN_TRACE].reverse();
    const r = replayTrace(unordered);
    expect(r.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports the correct eventCount', () => {
    const r = replayTrace(CLEAN_TRACE);
    expect(r.eventCount).toBe(5);
  });

  it('reports totalElapsedMs from first to last timestamp', () => {
    const r = replayTrace(CLEAN_TRACE);
    expect(r.totalElapsedMs).toBe(4000);
  });

  it('counts events by kind', () => {
    const r = replayTrace(CLEAN_TRACE);
    expect(r.kinds).toEqual({
      plan: 1,
      search: 1,
      verify: 1,
      synthesise: 1,
      done: 1,
    });
  });

  it('produces a stranger-readable one-line summary', () => {
    const r = replayTrace(CLEAN_TRACE);
    expect(r.summary).toContain('5 events');
    expect(r.summary).toContain('4000 ms elapsed');
    expect(r.summary).toContain('plan×1');
    expect(r.summary).toContain('first: "Plan decided"');
    expect(r.summary).toContain('last: "Done"');
  });
});

describe('replay — diffTraces', () => {
  it('reports same: true for identical traces', () => {
    const a = CLEAN_TRACE;
    const b = CLEAN_TRACE;
    const d = diffTraces(a, b);
    expect(d.same).toBe(true);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.commonCount).toBe(5);
  });

  it('detects a differing event at the same seq', () => {
    const a = CLEAN_TRACE;
    const b = CLEAN_TRACE.map((e) =>
      e.seq === 3 ? ev(3, 3000, 'error', 'Something failed') : e,
    );
    const d = diffTraces(a, b);
    expect(d.same).toBe(false);
    expect(d.onlyInA.length).toBe(1);
    expect(d.onlyInA[0]!.kind).toBe('verify');
    expect(d.onlyInB.length).toBe(1);
    expect(d.onlyInB[0]!.kind).toBe('error');
    expect(d.commonCount).toBe(4);
  });

  it('detects events present only in one trace', () => {
    const a = CLEAN_TRACE;
    const b = [
      ...CLEAN_TRACE,
      ev(6, 6000, 'extra', 'Extra step'),
    ];
    const d = diffTraces(a, b);
    expect(d.same).toBe(false);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB.length).toBe(1);
    expect(d.onlyInB[0]!.seq).toBe(6);
  });
});

describe('replay — purity and source scan', () => {
  it('replayTrace does not mutate the input array', () => {
    const input: TraceEvent[] = [...CLEAN_TRACE].reverse();
    const before = JSON.stringify(input);
    replayTrace(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('is deterministic across calls', () => {
    const a = replayTrace(CLEAN_TRACE);
    const b = replayTrace(CLEAN_TRACE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: replay-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'replay-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===