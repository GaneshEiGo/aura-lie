// === FILE START ===
// packages/agents/test/dry-run-v2.test.ts
// PRD §10.9 · F-099.

import { describe, it, expect } from 'vitest';
import {
  compileDryRun,
  DRY_RUN_PREFIX,
  type PlannedAction,
} from '../src/dry-run-v2.js';

describe('dry-run — empty plan', () => {
  it('empty actions → zero counts, "Nothing planned" summary', () => {
    const d = compileDryRun([]);
    expect(d.readCount).toBe(0);
    expect(d.writeCount).toBe(0);
    expect(d.searchCount).toBe(0);
    expect(d.runCount).toBe(0);
    expect(d.irreversible).toBe(false);
    expect(d.summary).toBe(`${DRY_RUN_PREFIX} Nothing planned.`);
  });
});

describe('dry-run — single action kinds', () => {
  it('one read', () => {
    const d = compileDryRun([{ kind: 'read', target: 'a.md' }]);
    expect(d.readCount).toBe(1);
    expect(d.summary).toContain('1 read');
  });

  it('one write', () => {
    const d = compileDryRun([{ kind: 'write', target: 'b.md' }]);
    expect(d.writeCount).toBe(1);
    expect(d.summary).toContain('1 write');
  });

  it('one search', () => {
    const d = compileDryRun([{ kind: 'search', target: 'query' }]);
    expect(d.searchCount).toBe(1);
    expect(d.summary).toContain('1 search');
  });

  it('one run', () => {
    const d = compileDryRun([{ kind: 'run', target: 'script' }]);
    expect(d.runCount).toBe(1);
    expect(d.summary).toContain('1 run');
  });
});

describe('dry-run — mixed actions and pluralisation', () => {
  const actions: PlannedAction[] = [
    { kind: 'read', target: 'a' },
    { kind: 'read', target: 'b' },
    { kind: 'read', target: 'c' },
    { kind: 'write', target: 'd' },
    { kind: 'write', target: 'e' },
    { kind: 'search', target: 'f' },
    { kind: 'run', target: 'g' },
  ];

  it('aggregates counts by kind', () => {
    const d = compileDryRun(actions);
    expect(d.readCount).toBe(3);
    expect(d.writeCount).toBe(2);
    expect(d.searchCount).toBe(1);
    expect(d.runCount).toBe(1);
  });

  it('pluralises multi-count items and singularises single-count items', () => {
    const d = compileDryRun(actions);
    expect(d.summary).toContain('3 reads');
    expect(d.summary).toContain('2 writes');
    expect(d.summary).toContain('1 search');
    expect(d.summary).toContain('1 run');
  });

  it('summary begins with the exact DRY_RUN_PREFIX', () => {
    const d = compileDryRun(actions);
    expect(d.summary.startsWith(DRY_RUN_PREFIX)).toBe(true);
  });
});

describe('dry-run — irreversible flag', () => {
  it('irreversible false when no action is flagged', () => {
    const d = compileDryRun([
      { kind: 'read', target: 'a' },
      { kind: 'write', target: 'b' },
    ]);
    expect(d.irreversible).toBe(false);
  });

  it('irreversible true when any action is flagged', () => {
    const d = compileDryRun([
      { kind: 'read', target: 'a' },
      { kind: 'write', target: 'b', irreversible: true },
    ]);
    expect(d.irreversible).toBe(true);
  });
});

describe('dry-run — determinism and summary shape', () => {
  it('same input produces identical output twice', () => {
    const actions: PlannedAction[] = [
      { kind: 'read', target: 'x' },
      { kind: 'write', target: 'y' },
    ];
    const a = compileDryRun(actions);
    const b = compileDryRun(actions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('summary contains no newline (one-line contract per PRD §10.9)', () => {
    const d = compileDryRun([{ kind: 'read', target: 'x' }]);
    expect(d.summary).not.toContain('\n');
  });

  it('source scan: dry-run-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'dry-run-v2.ts'),
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