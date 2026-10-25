// packages/autonomy-runner/src/goals.ts
// PRD 10.9: "Goals break into tasks with owners and dependencies."

import type { Goal, Task, TaskStatus } from './types.js';

export class GoalStackError extends Error {}

export interface TaskSpec {
  id: string;
  description: string;
  action: string;
  resource: string;
  permissionClass?: Task['permissionClass'];
  dependsOn?: string[];
  irreversible?: boolean;
}

export function buildGoal(
  description: string,
  specs: TaskSpec[],
  now: number = Date.now(),
): Goal {
  const ids = new Set<string>();
  for (const s of specs) {
    if (!s.id) throw new GoalStackError('task missing id');
    if (ids.has(s.id)) throw new GoalStackError(`duplicate task id: ${s.id}`);
    ids.add(s.id);
  }

  const tasks: Task[] = specs.map((s) => ({
    id: s.id,
    description: s.description,
    action: s.action,
    resource: s.resource,
    permissionClass: s.permissionClass ?? 'read',
    dependsOn: s.dependsOn ?? [],
    irreversible: s.irreversible ?? false,
    status: 'pending',
    approval: 'not_required',
  }));

  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!ids.has(d)) {
        throw new GoalStackError(`task ${t.id} depends on unknown ${d}`);
      }
    }
  }

  detectCycle(tasks);

  return {
    id: `goal-${now}-${Math.random().toString(36).slice(2, 8)}`,
    description,
    tasks,
    createdAt: now,
  };
}

export function detectCycle(tasks: Task[]): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  tasks.forEach((t) => color.set(t.id, WHITE));

  function visit(id: string): void {
    const c = color.get(id);
    if (c === GRAY) throw new GoalStackError(`cycle detected at ${id}`);
    if (c === BLACK) return;
    color.set(id, GRAY);
    const task = byId.get(id);
    if (task) {
      for (const d of task.dependsOn) visit(d);
    }
    color.set(id, BLACK);
  }

  for (const t of tasks) visit(t.id);
}

export function readyTasks(goal: Goal): Task[] {
  const done = new Set(
    goal.tasks.filter((t) => t.status === 'done').map((t) => t.id),
  );
  return goal.tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    return t.dependsOn.every((d) => done.has(d));
  });
}

export function isGoalComplete(goal: Goal): boolean {
  return goal.tasks.every((t) => t.status === 'done');
}

export function markTask(goal: Goal, taskId: string, status: TaskStatus): Goal {
  return {
    ...goal,
    tasks: goal.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
  };
}

export function topologicalOrder(tasks: Task[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order: string[] = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const t = byId.get(id);
    if (!t) return;
    for (const d of t.dependsOn) visit(d);
    order.push(id);
  }
  for (const t of tasks) visit(t.id);
  return order;
}