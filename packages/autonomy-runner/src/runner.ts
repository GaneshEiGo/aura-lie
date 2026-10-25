// packages/autonomy-runner/src/runner.ts
// PRD 10.9: "Steps run as resumable jobs: a Durable Object holds mission
// state, a Cron tick or a Queue message triggers the next step, and the
// client can resume a step with a continue token."

import type {
  Goal,
  MissionState,
  MissionStep,
  RunnerOptions,
  StepExecutor,
  StepOutcome,
} from './types.js';
import {
  MISSION_MAX_STEPS,
  MISSION_STEP_EXTERNAL_CAP,
  NO_PROGRESS_WINDOW,
} from './types.js';
import { checkStopConditions } from './stop.js';
import { checkPermission } from './permission.js';
import { readyTasks, markTask } from './goals.js';

export interface CreateMissionInput {
  goal: Goal;
  deadlineAt?: number;
  maxSteps?: number;
  startAt?: number;
}

export function createMission(input: CreateMissionInput): MissionState {
  const now = input.startAt ?? Date.now();
  return {
    id: `mission-${now}-${Math.random().toString(36).slice(2, 8)}`,
    goal: input.goal,
    step: 0,
    maxSteps: input.maxSteps ?? MISSION_MAX_STEPS,
    deadlineAt: input.deadlineAt,
    startAt: now,
    status: 'running',
    history: [],
    handoff: {},
    callBudget: { used: 0, total: MISSION_MAX_STEPS },
    noProgressWindow: NO_PROGRESS_WINDOW,
  };
}

export class Runner {
  private readonly executor: StepExecutor;
  private readonly options: RunnerOptions;

  constructor(executor: StepExecutor, options: RunnerOptions = {}) {
    this.executor = executor;
    this.options = options;
  }

  approve(mission: MissionState, taskId: string): MissionState {
    return {
      ...mission,
      goal: {
        ...mission.goal,
        tasks: mission.goal.tasks.map((t) =>
          t.id === taskId ? { ...t, approval: 'approved' as const } : t,
        ),
      },
    };
  }

  reject(mission: MissionState, taskId: string): MissionState {
    return {
      ...mission,
      goal: {
        ...mission.goal,
        tasks: mission.goal.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                approval: 'rejected' as const,
                status: 'blocked' as const,
              }
            : t,
        ),
      },
    };
  }

  async step(mission: MissionState): Promise<StepOutcome> {
    const now = (this.options.clock ?? { now: () => Date.now() }).now();

    const stop = checkStopConditions({
      goal: mission.goal,
      mission,
      options: this.options,
      now,
    });
    if (stop) {
      const status =
        stop === 'goal-achieved' || stop === 'evidence-sufficient'
          ? 'done'
          : 'stopped';
      return {
        state: { ...mission, status, stopReason: stop },
        stopped: true,
        stopReason: stop,
        // FR-AGENT-03: the caller (Inbox / Queue) needs to know whether the
        // stop was caused by a pending approval, so it can present Approve /
        // Review / Reject. Both the pre-check AND the permission gate must
        // surface this flag.
        requiresApproval: stop === 'permission-required' ? true : undefined,
      };
    }

    const ready = readyTasks(mission.goal);
    if (ready.length === 0) {
      return {
        state: { ...mission, status: 'stopped', stopReason: 'no-progress' },
        stopped: true,
        stopReason: 'no-progress',
      };
    }

    const task = ready[0];

    const level = this.options.level ?? 2;
    const decision = checkPermission(task, level);

    if (decision === 'never') {
      return {
        state: {
          ...mission,
          status: 'stopped',
          stopReason: 'permission-required',
        },
        stopped: true,
        stopReason: 'permission-required',
      };
    }

    if (decision === 'ask' && task.approval !== 'approved') {
      return {
        state: {
          ...mission,
          status: 'stopped',
          stopReason: 'permission-required',
        },
        stopped: true,
        stopReason: 'permission-required',
        requiresApproval: true,
      };
    }

    // Execute the task
    let result;
    try {
      result = await this.executor(task, mission);
    } catch (err) {
      result = {
        result: 'failed' as const,
        externalCalls: 0,
        outputArtifacts: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Enforce per-step external call cap (PRD 10.9)
    const cap = this.options.perStepExternalCallCap ?? MISSION_STEP_EXTERNAL_CAP;
    if (result.externalCalls > cap) {
      result = {
        ...result,
        result: 'failed',
        error: `step exceeded ${cap} external calls (PRD 10.9)`,
      };
    }

    const stepRecord: MissionStep = {
      index: mission.step,
      taskId: task.id,
      action: task.action,
      result: result.result,
      externalCalls: result.externalCalls,
      at: now,
      outputArtifacts: result.outputArtifacts,
      error: result.error,
    };

    const updatedGoal = markTask(
      mission.goal,
      task.id,
      result.result === 'done'
        ? 'done'
        : result.result === 'failed'
          ? 'failed'
          : 'running',
    );

    const updatedHandoff = result.handoff
      ? { ...mission.handoff, ...result.handoff }
      : mission.handoff;

    const updatedMission: MissionState = {
      ...mission,
      goal: updatedGoal,
      step: mission.step + 1,
      history: [...mission.history, stepRecord],
      handoff: updatedHandoff,
      callBudget: {
        used: mission.callBudget.used + result.externalCalls,
        total: mission.callBudget.total,
      },
    };

    // Post-step stop check (goal-achieved may have just fired)
    const post = checkStopConditions({
      goal: updatedGoal,
      mission: updatedMission,
      options: this.options,
      now,
    });

    if (post) {
      const status =
        post === 'goal-achieved' || post === 'evidence-sufficient'
          ? 'done'
          : 'stopped';
      return {
        state: { ...updatedMission, status, stopReason: post },
        stopped: true,
        stopReason: post,
        requiresApproval: post === 'permission-required' ? true : undefined,
        executedTaskId: task.id,
      };
    }

    return {
      state: updatedMission,
      stopped: false,
      executedTaskId: task.id,
    };
  }
}