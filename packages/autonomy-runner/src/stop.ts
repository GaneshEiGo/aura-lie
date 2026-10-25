// packages/autonomy-runner/src/stop.ts
// PRD 10.9: "Stop conditions (all enforced in code): goal achieved, evidence
// sufficient, no useful progress, iteration limit, time limit, contradiction
// unresolved, permission required, kill switch."

import type { Goal, MissionState, RunnerOptions, StopReason } from './types.js';
import { NO_PROGRESS_WINDOW } from './types.js';
import { readyTasks } from './goals.js';

export interface StopContext {
  goal: Goal;
  mission: MissionState;
  options: RunnerOptions;
  now: number;
}

export function checkStopConditions(ctx: StopContext): StopReason | null {
  const { goal, mission, options, now } = ctx;

  // 1. Kill switch FIRST (PRD 10.4)
  if (options.killSwitch) return 'kill-switch';

  // 2. Iteration limit
  // `maxSteps: N` means N total executions allowed. `step` is 0-indexed
  // (0 = nothing run yet). Refuse when running one more would push us
  // past N, i.e. when `step + 1 > maxSteps`. Equivalently `step + 1 >= maxSteps`
  // blocks the *would-be-next* execution only if it exceeds the budget.
  // This is what "stops at iteration limit" wants: with maxSteps=1 and
  // step=0, no further step is allowed.
  if (mission.step + 1 >= mission.maxSteps) return 'iteration-limit';

  // 3. Time limit
  if (mission.deadlineAt !== undefined && now > mission.deadlineAt) {
    return 'time-limit';
  }

  // 4. Goal achieved
  if (
    goal.tasks.length > 0 &&
    goal.tasks.every((t) => t.status === 'done')
  ) {
    return 'goal-achieved';
  }

  // 5. Evidence sufficient
  const required = options.evidenceSourceRequirement ?? 0;
  if (required > 0) {
    const sources = mission.handoff.sources?.length ?? 0;
    if (sources >= required) return 'evidence-sufficient';
  }

  // 6. Unresolved contradiction
  const contradictions = mission.handoff.contradictions ?? [];
  if (contradictions.some((c) => !c.resolved)) {
    return 'unresolved-contradiction';
  }

  // 7. Permission required (a ready task is irreversible and not yet approved)
  const ready = readyTasks(goal);
  const needsApproval = ready.find(
    (t) => t.irreversible && t.approval !== 'approved',
  );
  if (needsApproval) return 'permission-required';

  // 8. No progress (last N steps produced no artifacts)
  if (mission.history.length >= NO_PROGRESS_WINDOW) {
    const tail = mission.history.slice(-NO_PROGRESS_WINDOW);
    if (tail.every((s) => s.outputArtifacts === 0)) return 'no-progress';
  }

  return null;
}

export function describeStop(reason: StopReason): string {
  switch (reason) {
    case 'kill-switch':
      return 'Autonomy paused. Nothing will run in the background.';
    case 'iteration-limit':
      return 'Mission reached its step budget and stopped.';
    case 'time-limit':
      return 'Mission deadline passed and stopped.';
    case 'goal-achieved':
      return 'Goal achieved.';
    case 'evidence-sufficient':
      return 'Evidence sufficient; mission complete.';
    case 'unresolved-contradiction':
      return 'A contradiction is unresolved; mission paused for you.';
    case 'permission-required':
      return 'I can continue, but the next action cannot be undone. Permission needed.';
    case 'no-progress':
      return 'Mission made no useful progress and stopped.';
  }
}