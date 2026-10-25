// === FILE START ===
// packages/agents/test/replay-view-v2.test.ts
// PRD §10.9 · §15.5 · F-098 · FR-AGENT-06.

import { describe, it, expect } from 'vitest';
import { buildReplayView } from '../src/replay-view-v2.js';
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
  ev(3, 3000, 'verify', 'Verify claim 1'),
  ev(4, 4200, 'synthesise', 'Synthesised answer'),
  ev(5, 5000, 'done', 'Done'),
];

describe('replay-view — shape and ordering', () => {
  it('empty trace → empty view', () => {
    expect(buildReplayView([])).toEqual([]);
  });

  it('one event → one row carrying the event seq', () => {
    const rows = buildReplayView([ev(7, 1000, 'plan', 'Go')]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.seq).toBe(7);
  });

  it('rows are sorted by seq regardless of input order', () => {
    const shuffled = [...BASE].reverse();
    const rows = buildReplayView(shuffled);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('replay-view — displayKind and iconKey', () => {
  it('known kind "plan" maps to displayKind "Plan" and iconKey "plan"', () => {
    const rows = buildReplayView([ev(1, 1000, 'plan', 'Go')]);
    expect(rows[0]!.displayKind).toBe('Plan');
    expect(rows[0]!.iconKey).toBe('plan');
  });

  it('unknown kind falls back to iconKey "other" and a capitalised label', () => {
    const rows = buildReplayView([ev(1, 1000, 'mystery', 'X')]);
    expect(rows[0]!.iconKey).toBe('other');
    expect(rows[0]!.displayKind).toBe('Mystery');
  });

  it('empty-string kind falls back to "Unknown"', () => {
    const rows = buildReplayView([ev(1, 1000, '', 'X')]);
    expect(rows[0]!.iconKey).toBe('other');
    expect(rows[0]!.displayKind).toBe('Unknown');
  });
});

describe('replay-view — accessible label', () => {
  it('accessibleLabel names the display kind, the step, and the description', () => {
    const rows = buildReplayView([ev(2, 2000, 'search', 'Search 1')]);
    const label = rows[0]!.accessibleLabel;
    expect(label).toContain('Search');
    expect(label).toContain('step 2');
    expect(label).toContain('Search 1');
  });
});

describe('replay-view — timestamps', () => {
  it('relativeTimestampMs is 0 for the first row', () => {
    const rows = buildReplayView(BASE);
    expect(rows[0]!.relativeTimestampMs).toBe(0);
    expect(rows[0]!.timestampLabel).toBe('t+0ms');
  });

  it('relativeTimestampMs is delta from the first event for later rows', () => {
    const rows = buildReplayView(BASE);
    expect(rows[2]!.relativeTimestampMs).toBe(2000); // 3000 - 1000
  });

  it('uses "ms" for < 1000ms and "s" for >= 1000ms', () => {
    const rows = buildReplayView(BASE);
    expect(rows[0]!.timestampLabel).toBe('t+0ms');
    expect(rows[3]!.timestampLabel).toBe('t+3.2s'); // 3200ms
  });
});

describe('replay-view — jump affordance', () => {
  it('every row carries a jumpAffordance with seq and a label naming the seq', () => {
    const rows = buildReplayView(BASE);
    for (const r of rows) {
      expect(r.jumpAffordance.seq).toBe(r.seq);
      expect(r.jumpAffordance.label).toContain(String(r.seq));
    }
  });
});

describe('replay-view — purity and source scan', () => {
  it('does not mutate the input array', () => {
    const input: TraceEvent[] = [...BASE].reverse();
    const before = JSON.stringify(input);
    buildReplayView(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('source scan: replay-view-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'replay-view-v2.ts'),
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