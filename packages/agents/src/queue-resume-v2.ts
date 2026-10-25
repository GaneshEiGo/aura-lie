// === FILE START ===
// packages/agents/src/queue-resume-v2.ts
// PRD §10.4 · §13.7 · F-084 · FR-AGENT-02 · T-13.
//
// The Queue-based resume contract for a durable mission. Every resume attempt
// is a `ResumeMessage` with a bounded attempt count and exponential backoff.
// `decideTick` is the pure decision function the Worker's cron / queue handler
// calls before doing any work.
//
// The rules (from PRD §10.4 and §13.7):
//   · The kill switch is checked FIRST.
//   · A stopped or exhausted mission drops every resume attempt.
//   · An expired message (older than MESSAGE_TTL_MS) drops rather than running
//     stale work.
//   · A message with attemptNumber > MAX_ATTEMPTS drops.
//   · A message scheduled for the future returns `wait`.
//   · Otherwise, run.
//
// Backoff: exponential with base 30s, factor 3, capped at 15 min.
//
// Only relative imports (from the sibling durable-mission module for the
// shared state type).

import type { DurableMissionState } from './durable-mission-v2.js';

export const MAX_ATTEMPTS = 3;
export const MESSAGE_TTL_MS = 5 * 60_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_FACTOR = 3;
export const BACKOFF_MAX_MS = 15 * 60_000;

export interface ResumeMessage {
  kind: 'resume-mission';
  missionId: string;
  token: string;
  attemptNumber: number;
  enqueuedAtMs: number;
  visibleAtMs: number;
}

export function makeResumeMessage(
  missionId: string,
  token: string,
  nowMs: number,
  attemptNumber: number = 1,
  delayMs: number = 0,
): ResumeMessage {
  if (typeof missionId !== 'string' || missionId.length === 0) {
    throw new Error('makeResumeMessage: missionId must be a non-empty string');
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('makeResumeMessage: token must be a non-empty string');
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error('makeResumeMessage: attemptNumber must be a positive integer');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('makeResumeMessage: delayMs must be a non-negative number');
  }
  return {
    kind: 'resume-mission',
    missionId,
    token,
    attemptNumber,
    enqueuedAtMs: nowMs,
    visibleAtMs: nowMs + delayMs,
  };
}

export function isExpired(msg: ResumeMessage, nowMs: number): boolean {
  return nowMs - msg.enqueuedAtMs > MESSAGE_TTL_MS;
}

/** Exponential backoff: 30s, 90s, 270s, … capped at 15 min. */
export function nextBackoffMs(attemptNumber: number): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    return BACKOFF_BASE_MS;
  }
  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attemptNumber - 1);
  return Math.min(BACKOFF_MAX_MS, raw);
}

export type TickDropReason =
  | 'kill-switch'
  | 'stopped'
  | 'exhausted'
  | 'wrong-mission'
  | 'expired'
  | 'attempts-exceeded';

export type TickDecision =
  | { kind: 'run'; token: string }
  | { kind: 'wait'; untilMs: number }
  | { kind: 'drop'; reason: TickDropReason };

export interface TickContext {
  state: DurableMissionState;
  msg: ResumeMessage;
  nowMs: number;
  killSwitch: boolean;
}

export function decideTick(ctx: TickContext): TickDecision {
  const { state, msg, nowMs, killSwitch } = ctx;
  if (killSwitch) return { kind: 'drop', reason: 'kill-switch' };
  if (state.stopped !== null) return { kind: 'drop', reason: 'stopped' };
  if (state.cursor >= state.totalSteps) return { kind: 'drop', reason: 'exhausted' };
  if (msg.missionId !== state.id) return { kind: 'drop', reason: 'wrong-mission' };
  if (isExpired(msg, nowMs)) return { kind: 'drop', reason: 'expired' };
  if (msg.attemptNumber > MAX_ATTEMPTS) {
    return { kind: 'drop', reason: 'attempts-exceeded' };
  }
  if (nowMs < msg.visibleAtMs) {
    return { kind: 'wait', untilMs: msg.visibleAtMs };
  }
  return { kind: 'run', token: msg.token };
}

/**
 * Follow-up message after a slice runs. Success → null (no retry). Failure
 * with attempts remaining → a new message with incremented attemptNumber and
 * delayed visibility. Failure on the final attempt → null (give up).
 */
export function followUpMessage(
  msg: ResumeMessage,
  nowMs: number,
  succeeded: boolean,
): ResumeMessage | null {
  if (succeeded) return null;
  if (msg.attemptNumber >= MAX_ATTEMPTS) return null;
  const next = msg.attemptNumber + 1;
  const delay = nextBackoffMs(msg.attemptNumber);
  return makeResumeMessage(msg.missionId, `retry-${next}`, nowMs, next, delay);
}
// === FILE END ===