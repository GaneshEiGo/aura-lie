// === FILE START ===
// packages/agents/src/mission-scenario-v2.ts
// PRD §15.5 · §10.9 · F-097 · F-100.
//
// End-to-end mission runner. Ties the four Section 104 primitives together:
//
//   Goal + TaskPlans ──► compileDryRun ──► MissionRunner ──► StopReason
//
// The rules the PRD asks for are enforced structurally:
//
//   · Dry-run runs FIRST. It lists every planned action and says explicitly
//     that no external action will occur. Nothing else has happened yet.
//   · An irreversible planned action makes its task's outcome carry
//     `requiresPermission: true`. The MissionRunner therefore returns
//     `permission-required` for that step — which is the PRD's literal rule
//     "If the next step is irreversible, Aura-lie stops with: 'I can
//     continue, but the next action cannot be undone. Permission needed.'"
//   · A blocked step (permission-required or kill-switch) records no-progress,
//     NOT progress. The action did not run; the trace must say so.
//   · The kill switch is honoured on every step via the callback.
//   · The mission state is returned even when stopped, so callers can replay.
//
// FIX HISTORY (post Section 106):
//   The previous version pushed a `progress` event whenever the plan claimed
//   madeProgress: true, even if the step's stop reason was permission-required
//   or kill-switch. That contradicted the semantic of "the side effect never
//   executed". The rule is now: a blocked step emits no-progress with a
//   "Blocked by <reason>" description. Progress only fires for steps that
//   actually committed their work.

import type { PlannedAction, DryRunSummary } from './dry-run-v2.js';
import { compileDryRun } from './dry-run-v2.js';
import type {
  MissionConfig,
  MissionState,
  StepOutcome,
  StopReason,
} from './mission-runner-v2.js';
import { createMission, stepMission } from './mission-runner-v2.js';

export interface MissionEvent {
  seq: number;
  timestampMs: number;
  kind:
    | 'dry-run'
    | 'step'
    | 'progress'
    | 'no-progress'
    | 'stop';
  description: string;
  taskId?: string;
  stopReason?: StopReason;
}

export interface TaskPlan {
  taskId: string;
  plannedActions: PlannedAction[];
  /** The outcome the step function is going to report for this task. */
  outcome: StepOutcome;
}

export interface EndToEndConfig {
  missionId: string;
  mission: MissionConfig;
  startMs: number;
  killSwitchActive?: boolean;
}

export interface EndToEndRun {
  missionId: string;
  events: MissionEvent[];
  stopped: StopReason | null;
  dryRun: DryRunSummary;
  finalState: MissionState;
}

const STEP_CLOCK_ADVANCE_MS = 1_000;

/** A stop reason that means "the step did not execute". */
function isBlockedStop(reason: StopReason | null): boolean {
  return reason === 'permission-required' || reason === 'kill-switch';
}

export async function runEndToEnd(
  taskPlans: readonly TaskPlan[],
  config: EndToEndConfig,
): Promise<EndToEndRun> {
  // 1. Dry-run first. Nothing else has happened yet.
  const allActions: PlannedAction[] = [];
  for (const p of taskPlans) {
    for (const a of p.plannedActions) allActions.push(a);
  }
  const dryRun = compileDryRun(allActions);

  const events: MissionEvent[] = [];
  let seq = 0;
  let nowMs = config.startMs;

  events.push({
    seq: ++seq,
    timestampMs: nowMs,
    kind: 'dry-run',
    description: dryRun.summary,
  });

  // 2. Set up the mission.
  let state: MissionState = createMission(
    config.missionId,
    config.mission,
    config.startMs,
  );
  let stopped: StopReason | null = null;

  const cbs = {
    killSwitchActive: (): boolean => config.killSwitchActive === true,
    nowMs: (): number => nowMs,
  };

  // 3. Walk the task plans one at a time. Stop as soon as a stop fires.
  for (const plan of taskPlans) {
    if (stopped !== null) break;

    // Enforce the PRD rule at the call site: any irreversible action in this
    // task forces requiresPermission, no matter what the plan claimed.
    const hasIrreversible = plan.plannedActions.some(
      (a) => a.irreversible === true,
    );

    const stepFn = (): StepOutcome => {
      if (hasIrreversible) {
        return { ...plan.outcome, requiresPermission: true };
      }
      return plan.outcome;
    };

    const result = await stepMission(
      state,
      config.mission,
      stepFn,
      cbs,
    );
    state = result.state;
    nowMs += STEP_CLOCK_ADVANCE_MS;

    events.push({
      seq: ++seq,
      timestampMs: nowMs,
      kind: 'step',
      description: `Task ${plan.taskId} ran`,
      taskId: plan.taskId,
    });

    // A blocked step (permission-required or kill-switch) did NOT execute —
    // its side effect never ran. The trace must say "no-progress", not
    // "progress", for that task. This is the "the irreversible task's side
    // effects are never executed" contract.
    const blocked = isBlockedStop(result.stopped);

    if (plan.outcome.madeProgress && !blocked) {
      events.push({
        seq: ++seq,
        timestampMs: nowMs,
        kind: 'progress',
        description: `Made progress on ${plan.taskId}`,
        taskId: plan.taskId,
      });
    } else {
      events.push({
        seq: ++seq,
        timestampMs: nowMs,
        kind: 'no-progress',
        description: blocked
          ? `Blocked by ${result.stopped} on ${plan.taskId}`
          : `No progress on ${plan.taskId}`,
        taskId: plan.taskId,
      });
    }

    if (result.stopped !== null) {
      stopped = result.stopped;
      events.push({
        seq: ++seq,
        timestampMs: nowMs,
        kind: 'stop',
        description: `Stopped: ${stopped}`,
        stopReason: stopped,
      });
    }
  }

  return {
    missionId: config.missionId,
    events,
    stopped,
    dryRun,
    finalState: state,
  };
}
// === FILE END ===