// === FILE START ===
// packages/agents/test/mission-scenario-v2.test.ts
// PRD §15.5 · §10.9 · F-097 · F-100.

import { describe, it, expect } from 'vitest';
import { runEndToEnd, type TaskPlan } from '../src/mission-scenario-v2.js';

const T0 = 1_000_000;

const BASE_CONFIG = {
  missionId: 'm-e2e',
  mission: { maxIterations: 20 },
  startMs: T0,
};

function okPlan(taskId: string): TaskPlan {
  return {
    taskId,
    plannedActions: [{ kind: 'read', target: `${taskId}.md` }],
    outcome: { madeProgress: true },
  };
}

function irreversiblePlan(taskId: string): TaskPlan {
  return {
    taskId,
    plannedActions: [{ kind: 'write', target: `${taskId}.md`, irreversible: true }],
    outcome: { madeProgress: true },
  };
}

describe('mission-scenario — empty and simple runs', () => {
  it('empty taskPlans → only the dry-run event, no step', async () => {
    const run = await runEndToEnd([], BASE_CONFIG);
    expect(run.events.length).toBe(1);
    expect(run.events[0]!.kind).toBe('dry-run');
    expect(run.stopped).toBeNull();
    expect(run.finalState.iterations).toBe(0);
  });

  it('one reversible task → dry-run, step, progress', async () => {
    const run = await runEndToEnd([okPlan('t1')], BASE_CONFIG);
    const kinds = run.events.map((e) => e.kind);
    expect(kinds).toEqual(['dry-run', 'step', 'progress']);
    expect(run.stopped).toBeNull();
    expect(run.finalState.iterations).toBe(1);
  });

  it('three reversible tasks → three steps, no stop', async () => {
    const plans = [okPlan('a'), okPlan('b'), okPlan('c')];
    const run = await runEndToEnd(plans, BASE_CONFIG);
    const stepCount = run.events.filter((e) => e.kind === 'step').length;
    expect(stepCount).toBe(3);
    expect(run.stopped).toBeNull();
    expect(run.finalState.iterations).toBe(3);
  });
});

describe('mission-scenario — progress and no-progress', () => {
  it('records no-progress when madeProgress is false', async () => {
    const plan: TaskPlan = {
      taskId: 't1',
      plannedActions: [{ kind: 'read', target: 'x' }],
      outcome: { madeProgress: false },
    };
    const run = await runEndToEnd([plan], BASE_CONFIG);
    const kinds = run.events.map((e) => e.kind);
    expect(kinds).toContain('no-progress');
    expect(kinds).not.toContain('progress');
  });

  it('stops with no-useful-progress after NO_PROGRESS_LIMIT consecutive stalls', async () => {
    const stalled: TaskPlan = {
      taskId: 'stall',
      plannedActions: [{ kind: 'read', target: 'x' }],
      outcome: { madeProgress: false },
    };
    const run = await runEndToEnd([stalled, stalled, stalled], BASE_CONFIG);
    expect(run.stopped).toBe('no-useful-progress');
  });
});

describe('mission-scenario — irreversible stops with permission-required', () => {
  it('an irreversible planned action stops the mission with permission-required', async () => {
    const run = await runEndToEnd([irreversiblePlan('ship')], BASE_CONFIG);
    expect(run.stopped).toBe('permission-required');
    const stopEvent = run.events.find((e) => e.kind === 'stop');
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.stopReason).toBe('permission-required');
  });

  it('the irreversible task\'s side effects are never executed', async () => {
    const run = await runEndToEnd([irreversiblePlan('ship')], BASE_CONFIG);
    // The step ran (it was evaluated) but the mission stopped with
    // permission-required and never produced a progress event for it.
    const progressForShip = run.events.find(
      (e) => e.kind === 'progress' && e.taskId === 'ship',
    );
    expect(progressForShip).toBeUndefined();
  });
});

describe('mission-scenario — other stop conditions', () => {
  it('kill switch active stops immediately with kill-switch', async () => {
    const run = await runEndToEnd([okPlan('t1')], {
      ...BASE_CONFIG,
      killSwitchActive: true,
    });
    expect(run.stopped).toBe('kill-switch');
  });

  it('iteration-limit stops after maxIterations', async () => {
    const plans = Array.from({ length: 5 }, (_, i) => okPlan(`t${i}`));
    const run = await runEndToEnd(plans, {
      ...BASE_CONFIG,
      mission: { maxIterations: 2 },
    });
    expect(run.stopped).toBe('iteration-limit');
  });

  it('goal-achieved stops the mission when the outcome reports it', async () => {
    const plan: TaskPlan = {
      taskId: 'finish',
      plannedActions: [{ kind: 'read', target: 'x' }],
      outcome: { madeProgress: true, goalAchieved: true },
    };
    const run = await runEndToEnd([plan], BASE_CONFIG);
    expect(run.stopped).toBe('goal-achieved');
  });
});

describe('mission-scenario — trace shape and determinism', () => {
  it('events have strictly increasing seq', async () => {
    const run = await runEndToEnd(
      [okPlan('a'), okPlan('b')],
      BASE_CONFIG,
    );
    for (let i = 1; i < run.events.length; i++) {
      expect(run.events[i]!.seq).toBeGreaterThan(run.events[i - 1]!.seq);
    }
  });

  it('events have non-decreasing timestampMs', async () => {
    const run = await runEndToEnd(
      [okPlan('a'), okPlan('b')],
      BASE_CONFIG,
    );
    for (let i = 1; i < run.events.length; i++) {
      expect(run.events[i]!.timestampMs).toBeGreaterThanOrEqual(
        run.events[i - 1]!.timestampMs,
      );
    }
  });

  it('dry-run summary names the actual counts', async () => {
    const plans = [
      okPlan('a'),
      {
        taskId: 'b',
        plannedActions: [
          { kind: 'search', target: 'wiki' },
          { kind: 'search', target: 'arxiv' },
        ],
        outcome: { madeProgress: true },
      } as TaskPlan,
    ];
    const run = await runEndToEnd(plans, BASE_CONFIG);
    expect(run.dryRun.readCount).toBe(1);
    expect(run.dryRun.searchCount).toBe(2);
  });

  it('is deterministic (same inputs → identical event log)', async () => {
    const a = await runEndToEnd([okPlan('t1'), okPlan('t2')], BASE_CONFIG);
    const b = await runEndToEnd([okPlan('t1'), okPlan('t2')], BASE_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: no non-relative imports in mission-scenario-v2.ts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'mission-scenario-v2.ts'),
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