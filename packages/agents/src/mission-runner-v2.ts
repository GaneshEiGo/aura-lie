// === FILE START ===
// packages/agents/src/mission-runner-v2.ts
// PRD §10.9 · FR-AGENT-02 · FR-AGENT-03 · F-097 · F-100 · T-13.
//
// Mission runner: a pure state machine. Every step is evaluated; the eight
// stop conditions from PRD §10.9 are checked in a defined priority order so
// outcomes are deterministic:
//
//   kill-switch > permission-required > contradiction-unresolved >
//   goal-achieved > evidence-sufficient > time-limit > iteration-limit >
//   no-useful-progress
//
// A "step function" produces a StepOutcome. Made-progress is required to
// reset the consecutive-no-progress counter; NO_PROGRESS_LIMIT consecutive
// stalls trigger 'no-useful-progress'.

export type StopReason =
  | 'goal-achieved'
  | 'evidence-sufficient'
  | 'no-useful-progress'
  | 'iteration-limit'
  | 'time-limit'
  | 'contradiction-unresolved'
  | 'permission-required'
  | 'kill-switch';

export const NO_PROGRESS_LIMIT = 2;

export interface MissionConfig {
  maxIterations: number;
  maxWallClockMs?: number;
}

export interface MissionState {
  id: string;
  iterations: number;
  consecutiveNoProgress: number;
  startedAtMs: number;
  stopped: StopReason | null;
}

export interface StepOutcome {
  madeProgress: boolean;
  goalAchieved?: boolean;
  evidenceSufficient?: boolean;
  unresolvedContradiction?: boolean;
  requiresPermission?: boolean;
}

export function createMission(
  id: string,
  config: MissionConfig,
  nowMs: number = Date.now(),
): MissionState {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('createMission: id must be a non-empty string');
  }
  if (!Number.isFinite(config.maxIterations) || config.maxIterations <= 0) {
    throw new Error('createMission: maxIterations must be a positive number');
  }
  return {
    id,
    iterations: 0,
    consecutiveNoProgress: 0,
    startedAtMs: nowMs,
    stopped: null,
  };
}

export interface StopContext {
  state: MissionState;
  outcome: StepOutcome;
  config: MissionConfig;
  nowMs: number;
  killSwitchActive: boolean;
}

export function evaluateStopConditions(ctx: StopContext): StopReason | null {
  const { state, outcome, config, nowMs, killSwitchActive } = ctx;
  if (killSwitchActive) return 'kill-switch';
  if (outcome.requiresPermission) return 'permission-required';
  if (outcome.unresolvedContradiction) return 'contradiction-unresolved';
  if (outcome.goalAchieved) return 'goal-achieved';
  if (outcome.evidenceSufficient) return 'evidence-sufficient';
  if (config.maxWallClockMs !== undefined && nowMs - state.startedAtMs >= config.maxWallClockMs) {
    return 'time-limit';
  }
  if (state.iterations >= config.maxIterations) return 'iteration-limit';
  if (state.consecutiveNoProgress >= NO_PROGRESS_LIMIT) return 'no-useful-progress';
  return null;
}

export interface StepCallbacks {
  killSwitchActive: () => boolean;
  nowMs: () => number;
}

export async function stepMission(
  state: MissionState,
  config: MissionConfig,
  stepFn: (state: MissionState) => Promise<StepOutcome> | StepOutcome,
  cbs: StepCallbacks,
): Promise<{ state: MissionState; stopped: StopReason | null }> {
  if (state.stopped !== null) {
    return { state, stopped: state.stopped };
  }

  const outcome = await stepFn(state);
  const nextIterations = state.iterations + 1;
  const nextNoProgress = outcome.madeProgress ? 0 : state.consecutiveNoProgress + 1;

  const interim: MissionState = {
    ...state,
    iterations: nextIterations,
    consecutiveNoProgress: nextNoProgress,
  };

  const stopped = evaluateStopConditions({
    state: interim,
    outcome,
    config,
    nowMs: cbs.nowMs(),
    killSwitchActive: cbs.killSwitchActive(),
  });

  return { state: { ...interim, stopped }, stopped };
}

export function requestStop(state: MissionState, reason: StopReason): MissionState {
  return { ...state, stopped: state.stopped ?? reason };
}
// === FILE END ===