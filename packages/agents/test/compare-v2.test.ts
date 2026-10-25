// === FILE START ===
// packages/agents/test/compare-v2.test.ts
// PRD §10.9 · FR-AGENT-06 · F-098.

import { describe, it, expect } from 'vitest';
import { runEndToEnd, type TaskPlan } from '../src/mission-scenario-v2.js';
import { compareRuns } from '../src/compare-v2.js';

const T0 = 1_000_000;
const BASE = {
  missionId: 'm-cmp',
  mission: { maxIterations: 20 },
  startMs: T0,
};

function planOk(taskId: string): TaskPlan {
  return {
    taskId,
    plannedActions: [{ kind: 'read', target: `${taskId}.md` }],
    outcome: { madeProgress: true },
  };
}

function planIrreversible(taskId: string): TaskPlan {
  return {
    taskId,
    plannedActions: [
      { kind: 'write', target: `${taskId}.md`, irreversible: true },
    ],
    outcome: { madeProgress: true },
  };
}

function planFail(taskId: string): TaskPlan {
  return {
    taskId,
    plannedActions: [{ kind: 'read', target: `${taskId}.md` }],
    outcome: { madeProgress: false },
  };
}

describe('compare — identical runs', () => {
  it('same input twice → same: true', async () => {
    const a = await runEndToEnd([planOk('t1'), planOk('t2')], BASE);
    const b = await runEndToEnd([planOk('t1'), planOk('t2')], BASE);
    const c = compareRuns(a, b);
    expect(c.same).toBe(true);
    expect(c.eventDiff.same).toBe(true);
    expect(c.stopSame).toBe(true);
    expect(c.dryRunSame).toBe(true);
  });

  it('narrative names "identical" for identical runs', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planOk('t1')], BASE);
    const c = compareRuns(a, b);
    expect(c.narrative.toLowerCase()).toContain('identical');
  });
});

describe('compare — differing runs', () => {
  it('a mission that stops vs one that does not → stopSame: false', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planIrreversible('t1')], BASE);
    const c = compareRuns(a, b);
    expect(c.same).toBe(false);
    expect(c.stopSame).toBe(false);
    expect(c.stopA).toBeNull();
    expect(c.stopB).toBe('permission-required');
  });

  it('narrative names the differing stop reasons', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planIrreversible('t1')], BASE);
    const c = compareRuns(a, b);
    expect(c.narrative).toContain('permission-required');
  });

  it('a longer run has events only in one side', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planOk('t1'), planOk('t2')], BASE);
    const c = compareRuns(a, b);
    expect(c.eventDiff.same).toBe(false);
    expect(c.eventDiff.onlyInB.length).toBeGreaterThan(0);
  });

  it('narrative names the "only in B" count', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planOk('t1'), planOk('t2')], BASE);
    const c = compareRuns(a, b);
    expect(c.narrative).toContain('only in B');
  });
});

describe('compare — dry-run diff', () => {
  it('dry-run diff fires when plans differ', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd(
      [
        {
          taskId: 't1',
          plannedActions: [
            { kind: 'search', target: 'wiki' },
            { kind: 'search', target: 'arxiv' },
          ],
          outcome: { madeProgress: true },
        },
      ],
      BASE,
    );
    const c = compareRuns(a, b);
    expect(c.dryRunSame).toBe(false);
    expect(c.narrative.toLowerCase()).toContain('dry-run');
  });

  it('dry-run diff stays false when only irreversible flag differs', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planIrreversible('t1')], BASE);
    const c = compareRuns(a, b);
    expect(c.dryRunSame).toBe(false);
  });
});

describe('compare — shape and determinism', () => {
  it('eventDiff.commonCount tracks the number of matching events', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planOk('t1')], BASE);
    const c = compareRuns(a, b);
    expect(c.eventDiff.commonCount).toBe(a.events.length);
  });

  it('eventDiff.onlyInA and onlyInB are sorted by seq', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd(
      [planOk('t1'), planOk('t2'), planFail('t3')],
      BASE,
    );
    const c = compareRuns(a, b);
    for (let i = 1; i < c.eventDiff.onlyInB.length; i++) {
      expect(c.eventDiff.onlyInB[i]!.seq).toBeGreaterThan(
        c.eventDiff.onlyInB[i - 1]!.seq,
      );
    }
  });

  it('is pure: comparing twice gives identical results', async () => {
    const a = await runEndToEnd([planOk('t1')], BASE);
    const b = await runEndToEnd([planIrreversible('t1')], BASE);
    const c1 = compareRuns(a, b);
    const c2 = compareRuns(a, b);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it('source scan: compare-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'compare-v2.ts'),
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