// === FILE START ===
// packages/agents/test/fork-view-v2.test.ts
// PRD §10.9 · §15.5 · F-098 · FR-AGENT-06.

import { describe, it, expect } from 'vitest';
import { forkAt } from '../src/fork-v2.js';
import { buildForkView } from '../src/fork-view-v2.js';
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

function baseFork() {
  return forkAt(BASE, 2, [
    { kind: 'error', description: 'Search failed' },
    { kind: 'retry', description: 'Retry search' },
  ]);
}

describe('fork-view — column sizes match the fork output', () => {
  it('leftColumn length equals prefix length', () => {
    const v = buildForkView(baseFork());
    expect(v.leftColumn.length).toBe(2); // prefix has events 1 and 2
  });

  it('rightColumn length equals forkedEvents length', () => {
    const v = buildForkView(baseFork());
    expect(v.rightColumn.length).toBe(2);
  });

  it('empty forkedEvents yields empty rightColumn', () => {
    const f = forkAt(BASE, 2, []);
    const v = buildForkView(f);
    expect(v.rightColumn.length).toBe(0);
  });
});

describe('fork-view — row statuses', () => {
  it('every leftColumn row is status "identical"', () => {
    const v = buildForkView(baseFork());
    for (const r of v.leftColumn) expect(r.status).toBe('identical');
  });

  it('every rightColumn row is status "new"', () => {
    const v = buildForkView(baseFork());
    for (const r of v.rightColumn) expect(r.status).toBe('new');
  });
});

describe('fork-view — payload preservation', () => {
  it('preserves seq in the left column', () => {
    const v = buildForkView(baseFork());
    expect(v.leftColumn.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('preserves seq in the right column (renumbered by forkAt)', () => {
    const v = buildForkView(baseFork());
    expect(v.rightColumn.map((r) => r.seq)).toEqual([3, 4]);
  });

  it('preserves kind and description in both columns', () => {
    const v = buildForkView(baseFork());
    expect(v.leftColumn[0]!.kind).toBe('plan');
    expect(v.leftColumn[0]!.description).toBe('Plan decided');
    expect(v.rightColumn[0]!.kind).toBe('error');
    expect(v.rightColumn[0]!.description).toBe('Search failed');
  });
});

describe('fork-view — header', () => {
  it('header is non-empty and mentions "Forked"', () => {
    const v = buildForkView(baseFork());
    expect(v.header.length).toBeGreaterThan(0);
    expect(v.header).toContain('Forked');
  });

  it('header names the fork step and both counts', () => {
    const v = buildForkView(baseFork());
    expect(v.header).toContain('step 2');
    expect(v.header).toContain('2 shared');
    expect(v.header).toContain('2 new');
  });

  it('forkSeq matches the prefix tail', () => {
    const v = buildForkView(baseFork());
    expect(v.forkSeq).toBe(2);
  });
});

describe('fork-view — purity and source scan', () => {
  it('is deterministic across calls', () => {
    const f = baseFork();
    const a = buildForkView(f);
    const b = buildForkView(f);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: fork-view-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'fork-view-v2.ts'),
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