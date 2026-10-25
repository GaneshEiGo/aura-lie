// === FILE START ===
// packages/agents/src/durable-mission-v2.ts
// PRD §10.9 · §13.7 · FR-AGENT-02 · F-097 · T-13.
//
// The Durable Object shape for a resumable mission (PRD §13.7):
//
//   "A job has kind, state, cursor, attempts, next_run_at. The Worker
//    processes a bounded slice (under 35 subrequests), saves the cursor,
//    and either streams a continue token to the client or schedules the
//    next slice through a Queue message or a Cron tick."
//
// This module is a pure data state machine. Every function returns a new
// state; the input is never mutated. Persistence is delegated to a
// `MissionStore` interface (in-memory for tests; Durable Object storage in
// production).
//
// Idempotency: each `applySlice` call carries a `token`. Replaying the same
// token returns `already-applied` and leaves the cursor untouched. Cloudflare
// Queues can deliver a message more than once; this is how we stay safe.
//
// Zero external imports.

export interface DurableBudget {
  maxSteps: number;
  maxSubrequests: number;
  usedSubrequests: number;
}

export interface DurableTraceEvent {
  seq: number;
  timestampMs: number;
  kind: 'slice' | 'attempt' | 'stop' | 'idle';
  detail: string;
}

export interface DurableMissionState {
  id: string;
  cursor: number;
  totalSteps: number;
  attempts: number;
  lastAppliedToken: string | null;
  stopped: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  budget: DurableBudget;
  trace: DurableTraceEvent[];
}

export interface SliceInput {
  token: string;
  subrequests: number;
  nowMs: number;
}

export type SliceReason =
  | 'applied'
  | 'already-applied'
  | 'subrequest-limit-exceeded'
  | 'stopped'
  | 'budget-exceeded';

export interface SliceResult {
  applied: boolean;
  reason: SliceReason;
  state: DurableMissionState;
}

/** PRD §13.7 hard cap: a single Worker slice may make at most 35 subrequests. */
export const MAX_SUBREQUESTS_PER_REQUEST = 35;

export function createDurableMission(
  id: string,
  config: { totalSteps: number; maxSubrequests: number },
  nowMs: number,
): DurableMissionState {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('createDurableMission: id must be a non-empty string');
  }
  if (!Number.isInteger(config.totalSteps) || config.totalSteps <= 0) {
    throw new Error('createDurableMission: totalSteps must be a positive integer');
  }
  if (!Number.isInteger(config.maxSubrequests) || config.maxSubrequests <= 0) {
    throw new Error('createDurableMission: maxSubrequests must be a positive integer');
  }
  return {
    id,
    cursor: 0,
    totalSteps: config.totalSteps,
    attempts: 0,
    lastAppliedToken: null,
    stopped: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    budget: {
      maxSteps: config.totalSteps,
      maxSubrequests: config.maxSubrequests,
      usedSubrequests: 0,
    },
    trace: [
      {
        seq: 1,
        timestampMs: nowMs,
        kind: 'idle',
        detail: `Mission ${id} created with ${config.totalSteps} steps`,
      },
    ],
  };
}

/**
 * Apply one bounded slice. Returns the new state and a reason code. Never
 * mutates the input. Replaying the same `token` returns `already-applied` with
 * the same state — the idempotency contract.
 */
export function applySlice(
  state: DurableMissionState,
  input: SliceInput,
): SliceResult {
  if (state.stopped !== null) {
    return { applied: false, reason: 'stopped', state };
  }
  if (
    !Number.isInteger(input.subrequests) ||
    input.subrequests < 0 ||
    input.subrequests > MAX_SUBREQUESTS_PER_REQUEST
  ) {
    return { applied: false, reason: 'subrequest-limit-exceeded', state };
  }
  if (state.lastAppliedToken === input.token) {
    return { applied: false, reason: 'already-applied', state };
  }
  if (state.cursor >= state.totalSteps) {
    return { applied: false, reason: 'budget-exceeded', state };
  }
  const nextUsed = state.budget.usedSubrequests + input.subrequests;
  if (nextUsed > state.budget.maxSubrequests) {
    return { applied: false, reason: 'budget-exceeded', state };
  }

  const nextSeq = state.trace.length + 1;
  const nextState: DurableMissionState = {
    ...state,
    cursor: state.cursor + 1,
    lastAppliedToken: input.token,
    updatedAtMs: input.nowMs,
    budget: { ...state.budget, usedSubrequests: nextUsed },
    trace: [
      ...state.trace,
      {
        seq: nextSeq,
        timestampMs: input.nowMs,
        kind: 'slice',
        detail: `Slice applied (cursor → ${state.cursor + 1})`,
      },
    ],
  };
  return { applied: true, reason: 'applied', state: nextState };
}

export function markAttempt(
  state: DurableMissionState,
  nowMs: number,
): DurableMissionState {
  const nextSeq = state.trace.length + 1;
  return {
    ...state,
    attempts: state.attempts + 1,
    updatedAtMs: nowMs,
    trace: [
      ...state.trace,
      {
        seq: nextSeq,
        timestampMs: nowMs,
        kind: 'attempt',
        detail: `Attempt ${state.attempts + 1}`,
      },
    ],
  };
}

export function setStopped(
  state: DurableMissionState,
  reason: string,
  nowMs: number,
): DurableMissionState {
  if (state.stopped !== null) return state;
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error('setStopped: reason must be a non-empty string');
  }
  const nextSeq = state.trace.length + 1;
  return {
    ...state,
    stopped: reason,
    updatedAtMs: nowMs,
    trace: [
      ...state.trace,
      {
        seq: nextSeq,
        timestampMs: nowMs,
        kind: 'stop',
        detail: `Stopped: ${reason}`,
      },
    ],
  };
}

export interface MissionStore {
  get(id: string): DurableMissionState | undefined;
  put(state: DurableMissionState): void;
}

export function createInMemoryStore(): MissionStore {
  const map = new Map<string, DurableMissionState>();
  return {
    get(id) {
      const stored = map.get(id);
      if (stored === undefined) return undefined;
      return JSON.parse(JSON.stringify(stored)) as DurableMissionState;
    },
    put(state) {
      map.set(state.id, JSON.parse(JSON.stringify(state)) as DurableMissionState);
    },
  };
}

export function saveMission(store: MissionStore, state: DurableMissionState): void {
  store.put(state);
}

export function loadMission(
  store: MissionStore,
  id: string,
): DurableMissionState | undefined {
  return store.get(id);
}
// === FILE END ===