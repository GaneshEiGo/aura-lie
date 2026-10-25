// === FILE START ===
// packages/agents/test/fork-v2.test.ts
// PRD §10.9 · FR-AGENT-06 · F-098.

import { describe, it, expect } from 'vitest';
import { forkAt } from '../src/fork-v2.js';
import type { TraceEvent } from '../src/replay-v2.js';

function ev(
  seq: number,
  ts: number,
  kind: string,
  description: string,
): TraceEvent {
  return { seq, timestampMs: ts, kind, description };
}

const BASE: readonly TraceEvent[] = [
  ev(1, 1000, 'plan', 'Plan decided'),
  ev(2, 2000, 'search', 'Search 1'),
  ev(3, 3000, 'verify', 'Verify 1'),
  ev(4, 4000, 'synthesise', 'Synthesise'),
  ev(5, 5000, 'done', 'Done'),
];

describe('fork — prefix', () => {
  it('prefix includes events up to and including forkSeq', () => {
    const r = forkAt(BASE, 2, [{ kind: 'error', description: 'Failed' }]);
    expect(r.prefix.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('prefix does not include events after the fork point', () => {
    const r = forkAt(BASE, 2, [{ kind: 'error', description: 'Failed' }]);
    expect(r.prefix.map((e) => e.seq)).not.toContain(3);
    expect(r.prefix.length).toBe(2);
  });

  it('prefix is a clone (does not alias the input)', () => {
    const r = forkAt(BASE, 2, [{ kind: 'error', description: 'Failed' }]);
    r.prefix[0]!.description = 'mutated';
    expect(BASE[0]!.description).toBe('Plan decided');
  });
});

describe('fork — forked events', () => {
  it('forked events start at forkSeq + 1', () => {
    const r = forkAt(BASE, 2, [{ kind: 'error', description: 'Failed' }]);
    expect(r.forkedEvents[0]!.seq).toBe(3);
  });

  it('forked events preserve kind and description', () => {
    const r = forkAt(BASE, 2, [{ kind: 'error', description: 'Failed' }]);
    expect(r.forkedEvents[0]!.kind).toBe('error');
    expect(r.forkedEvents[0]!.description).toBe('Failed');
  });

  it('forked events get monotonic seq across many alternatives', () => {
    const r = forkAt(BASE, 2, [
      { kind: 'a', description: '1' },
      { kind: 'b', description: '2' },
      { kind: 'c', description: '3' },
    ]);
    expect(r.forkedEvents.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('forked events carry caller-provided data when supplied', () => {
    const r = forkAt(BASE, 2, [
      { kind: 'x', description: 'y', data: { reason: 'retry' } },
    ]);
    expect(r.forkedEvents[0]!.data).toEqual({ reason: 'retry' });
  });
});

describe('fork — timestamp handling', () => {
  it('uses fork-point timestamp + index + 1 by default', () => {
    const r = forkAt(BASE, 2, [
      { kind: 'x', description: 'a' },
      { kind: 'y', description: 'b' },
    ]);
    expect(r.forkedEvents[0]!.timestampMs).toBe(2001);
    expect(r.forkedEvents[1]!.timestampMs).toBe(2002);
  });

  it('respects explicit timestampMs when supplied', () => {
    const r = forkAt(BASE, 2, [
      { kind: 'x', description: 'a', timestampMs: 9999 },
    ]);
    expect(r.forkedEvents[0]!.timestampMs).toBe(9999);
  });
});

describe('fork — validation', () => {
  it('throws on empty trace', () => {
    expect(() =>
      forkAt([], 1, [{ kind: 'x', description: 'a' }]),
    ).toThrow();
  });

  it('throws when forkSeq is not in the trace', () => {
    expect(() =>
      forkAt(BASE, 99, [{ kind: 'x', description: 'a' }]),
    ).toThrow();
  });

  it('throws when an alternative has an empty kind', () => {
    expect(() =>
      forkAt(BASE, 2, [{ kind: '', description: 'a' }]),
    ).toThrow();
  });
});

describe('fork — summary and determinism', () => {
  it('summary mentions the fork point and the count of forked events', () => {
    const r = forkAt(BASE, 2, [{ kind: 'x', description: 'a' }]);
    expect(r.summary).toContain('seq 2');
    expect(r.summary).toContain('1 event');
  });

  it('is deterministic across calls', () => {
    const a = forkAt(BASE, 2, [{ kind: 'x', description: 'a' }]);
    const b = forkAt(BASE, 2, [{ kind: 'x', description: 'a' }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: fork-v2.ts imports only from a relative sibling', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'fork-v2.ts'),
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
    const external = specifiers.filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });
});
// === FILE END ===