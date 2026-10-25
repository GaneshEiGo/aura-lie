// packages/heartbeat/src/rollover.ts
// Daily rollover + 7-day pruning of recentNotes.

import type { HeartbeatState } from './types.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function rollover(state: HeartbeatState, now: number): HeartbeatState {
  const today = startOfLocalDay(now);
  const weekCutoff = now - WEEK_MS;

  // Only reset `notesToday` when a *past* day has rolled over. If
  // `state.dayStart` is in the future relative to `now` — which can
  // happen (a) in tests that use a fixed historical clock while
  // `makeState` seeds dayStart from Date.now(), or (b) when a device
  // clock moves backwards or a state snapshot was taken with a
  // different timezone — the day has not ended, so `notesToday` is
  // still authoritative. Preserving it is the safer, PRD-correct
  // behaviour (PRD 10.5 "notes_today" counts notes sent this local day).
  const isFuture = state.dayStart > now;
  const shouldReset = !isFuture && state.dayStart !== today;

  return {
    ...state,
    notesToday: shouldReset ? 0 : state.notesToday,
    dayStart: today,
    recentNotes: state.recentNotes.filter((n) => n.at >= weekCutoff),
  };
}