// === FILE START ===
// packages/agents/test/goals-v2.test.ts
// PRD §10.9 · FR-AGENT-01 · FR-AGENT-05 · F-096.
//
// FIX HISTORY (post Section 104):
//   The last test used to do `const bad: Task = { dependsOn: 'not-an-array' }`
//   with @ts-expect-error and then assert `typeof bad.dependsOn !== 'string'`.
//   That cannot work: @ts-expect-error only silences the compiler, and at
//   runtime the value IS the string we assigned. A runtime assertion cannot
//   observe a TypeScript type. Replaced with a source scan that verifies the
//   declaration in goals-v2.ts is literally `dependsOn: string[]` — which is
//   the contract FR-AGENT-05 actually asks for.

import { describe, it, expect } from 'vitest';
import {
  createGoal,
  addTask,
  setTaskStatus,
  getReadyTasks,
  topologicalOrder,
  GoalError,
} from '../src/goals-v2.js';

function baseGoal() {
  return createGoal('g1', 'Ship v1');
}

describe('goals — createGoal', () => {
  it('creates an empty goal with the given id and title', () => {
    const g = createGoal('g1', 'Ship v1');
    expect(g.id).toBe('g1');
    expect(g.title).toBe('Ship v1');
    expect(g.tasks).toEqual([]);
  });

  it('rejects an empty id', () => {
    expect(() => createGoal('', 'x')).toThrow(GoalError);
  });
});

describe('goals — addTask', () => {
  it('appends a pending task', () => {
    const g = addTask(baseGoal(), {
      id: 't1', text: 'write spec', priority: 2, dependsOn: [],
    });
    expect(g.tasks.length).toBe(1);
    expect(g.tasks[0]!.status).toBe('pending');
  });

  it('rejects a duplicate id', () => {
    const g = addTask(baseGoal(), {
      id: 't1', text: 'write spec', priority: 2, dependsOn: [],
    });
    expect(() =>
      addTask(g, { id: 't1', text: 'dup', priority: 2, dependsOn: [] }),
    ).toThrow(GoalError);
  });

  it('preserves the dependsOn array', () => {
    const g = addTask(baseGoal(), {
      id: 't1', text: 'x', priority: 1, dependsOn: ['t0'],
    });
    expect(g.tasks[0]!.dependsOn).toEqual(['t0']);
  });
});

describe('goals — setTaskStatus', () => {
  it('updates the status of the matching task only', () => {
    let g = addTask(baseGoal(), { id: 't1', text: 'a', priority: 1, dependsOn: [] });
    g = addTask(g, { id: 't2', text: 'b', priority: 1, dependsOn: [] });
    g = setTaskStatus(g, 't1', 'done');
    expect(g.tasks.find((t) => t.id === 't1')!.status).toBe('done');
    expect(g.tasks.find((t) => t.id === 't2')!.status).toBe('pending');
  });

  it('rejects an unknown task id', () => {
    const g = baseGoal();
    expect(() => setTaskStatus(g, 'missing', 'done')).toThrow(GoalError);
  });
});

describe('goals — getReadyTasks', () => {
  it('returns pending tasks whose dependencies are all done', () => {
    let g = addTask(baseGoal(), { id: 't1', text: 'a', priority: 2, dependsOn: [] });
    g = addTask(g, { id: 't2', text: 'b', priority: 1, dependsOn: ['t1'] });
    const ready = getReadyTasks(g);
    expect(ready.map((t) => t.id)).toEqual(['t1']);
  });

  it('once t1 is done, t2 becomes ready', () => {
    let g = addTask(baseGoal(), { id: 't1', text: 'a', priority: 1, dependsOn: [] });
    g = addTask(g, { id: 't2', text: 'b', priority: 1, dependsOn: ['t1'] });
    g = setTaskStatus(g, 't1', 'done');
    const ready = getReadyTasks(g);
    expect(ready.map((t) => t.id)).toEqual(['t2']);
  });

  it('excludes done tasks from ready', () => {
    let g = addTask(baseGoal(), { id: 't1', text: 'a', priority: 1, dependsOn: [] });
    g = setTaskStatus(g, 't1', 'done');
    expect(getReadyTasks(g).length).toBe(0);
  });

  it('sorts by priority (1=highest first)', () => {
    let g = addTask(baseGoal(), { id: 'p3', text: 'x', priority: 3, dependsOn: [] });
    g = addTask(g, { id: 'p1', text: 'y', priority: 1, dependsOn: [] });
    g = addTask(g, { id: 'p2', text: 'z', priority: 2, dependsOn: [] });
    expect(getReadyTasks(g).map((t) => t.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('goals — topologicalOrder', () => {
  it('returns a valid linear order for a chain', () => {
    let g = addTask(baseGoal(), { id: 'a', text: 'A', priority: 1, dependsOn: [] });
    g = addTask(g, { id: 'b', text: 'B', priority: 1, dependsOn: ['a'] });
    g = addTask(g, { id: 'c', text: 'C', priority: 1, dependsOn: ['b'] });
    expect(topologicalOrder(g)).toEqual(['a', 'b', 'c']);
  });

  it('respects dependencies in a diamond', () => {
    let g = addTask(baseGoal(), { id: 'a', text: 'A', priority: 1, dependsOn: [] });
    g = addTask(g, { id: 'b', text: 'B', priority: 1, dependsOn: ['a'] });
    g = addTask(g, { id: 'c', text: 'C', priority: 1, dependsOn: ['a'] });
    g = addTask(g, { id: 'd', text: 'D', priority: 1, dependsOn: ['b', 'c'] });
    const order = topologicalOrder(g);
    const idx = (id: string) => order.indexOf(id);
    expect(idx('a')).toBeLessThan(idx('b'));
    expect(idx('a')).toBeLessThan(idx('c'));
    expect(idx('b')).toBeLessThan(idx('d'));
    expect(idx('c')).toBeLessThan(idx('d'));
  });

  it('throws on a cycle', () => {
    let g = addTask(baseGoal(), { id: 'a', text: 'A', priority: 1, dependsOn: ['b'] });
    g = addTask(g, { id: 'b', text: 'B', priority: 1, dependsOn: ['a'] });
    expect(() => topologicalOrder(g)).toThrow(GoalError);
  });

  it('throws on an unknown dependency', () => {
    const g = addTask(baseGoal(), {
      id: 'a', text: 'A', priority: 1, dependsOn: ['missing'],
    });
    expect(() => topologicalOrder(g)).toThrow(GoalError);
  });

  it('does not mutate the input goal', () => {
    const g = addTask(baseGoal(), { id: 'a', text: 'A', priority: 1, dependsOn: [] });
    const before = JSON.stringify(g);
    topologicalOrder(g);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('goals — source scan', () => {
  function extractSpecifiers(src: string): string[] {
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    return Array.from(noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g)).map(
      (m) => m[1]!,
    );
  }

  it('goals-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'goals-v2.ts'),
      'utf8',
    );
    expect(extractSpecifiers(src)).toEqual([]);
  });

  it('Task.dependsOn is declared as string[] in the source (FR-AGENT-05)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'goals-v2.ts'),
      'utf8',
    );
    // The declaration must be typed as string[] of task IDs.
    expect(src).toMatch(/dependsOn:\s*string\[\]/);
    // And it must not be a single free-text string.
    expect(src).not.toMatch(/dependsOn:\s*string\s*;/);
    expect(src).not.toMatch(/dependsOn:\s*string\s*\n/);
  });
});
// === FILE END ===