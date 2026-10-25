// === FILE START ===
// packages/agents/src/goals-v2.ts
// PRD §10.9 · FR-AGENT-01 · FR-AGENT-05 · F-096 · T-13.
//
// Goal stack: goals contain tasks with typed dependencies. Structured
// hand-off (FR-AGENT-05) is enforced by the shape: `dependsOn` is typed
// as string[] of task IDs, not free text. Topological order uses Kahn's
// algorithm and rejects cycles and unknown dependencies.
//
// Every operation returns a new Goal, never mutates input.

export type TaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed';
export type Priority = 1 | 2 | 3;

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  priority: Priority;
  dependsOn: string[];
}

export interface Goal {
  id: string;
  title: string;
  tasks: Task[];
}

export class GoalError extends Error {
  readonly kind = 'GoalError';
  constructor(message: string) {
    super(message);
    this.name = 'GoalError';
  }
}

export function createGoal(id: string, title: string): Goal {
  if (typeof id !== 'string' || id.length === 0) {
    throw new GoalError('createGoal: id must be a non-empty string');
  }
  return { id, title, tasks: [] };
}

export function addTask(goal: Goal, task: Omit<Task, 'status'>): Goal {
  if (goal.tasks.some((t) => t.id === task.id)) {
    throw new GoalError(`addTask: task id "${task.id}" already exists in goal "${goal.id}"`);
  }
  return {
    ...goal,
    tasks: [...goal.tasks, { ...task, status: 'pending' }],
  };
}

export function setTaskStatus(goal: Goal, taskId: string, status: TaskStatus): Goal {
  const idx = goal.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    throw new GoalError(`setTaskStatus: unknown task "${taskId}"`);
  }
  const updated = [...goal.tasks];
  updated[idx] = { ...updated[idx]!, status };
  return { ...goal, tasks: updated };
}

export function getReadyTasks(goal: Goal): Task[] {
  const doneSet = new Set(
    goal.tasks.filter((t) => t.status === 'done').map((t) => t.id),
  );
  return goal.tasks
    .filter((t) => t.status === 'pending' || t.status === 'ready')
    .filter((t) => t.dependsOn.every((d) => doneSet.has(d)))
    .sort((a, b) => a.priority - b.priority);
}

export function topologicalOrder(goal: Goal): string[] {
  const ids = new Set(goal.tasks.map((t) => t.id));
  // Guard: every dependency must exist.
  for (const t of goal.tasks) {
    for (const d of t.dependsOn) {
      if (!ids.has(d)) {
        throw new GoalError(
          `topologicalOrder: task "${t.id}" depends on unknown task "${d}"`,
        );
      }
    }
  }
  // Kahn's algorithm.
  const inDegree = new Map<string, number>();
  for (const t of goal.tasks) inDegree.set(t.id, 0);
  for (const t of goal.tasks) {
    for (const _d of t.dependsOn) {
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const t of goal.tasks) {
      if (t.dependsOn.includes(id)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) - 1);
        if (inDegree.get(t.id) === 0) queue.push(t.id);
      }
    }
  }
  if (result.length !== goal.tasks.length) {
    throw new GoalError('topologicalOrder: dependency cycle detected');
  }
  return result;
}
// === FILE END ===