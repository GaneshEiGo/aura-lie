// packages/heartbeat/src/quiet.ts
// PRD 10.5: quiet hours 23:00–08:00 local, per-type toggles.
// URGENT passes quiet hours only if the user enabled that.

import type { HeartbeatState, Trigger } from './types.js';

export function isQuietHour(
  now: number,
  startHour: number,
  endHour: number,
): boolean {
  const hour = new Date(now).getHours();
  if (startHour === endHour) return false; // zero-length window
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  // Cross-midnight window (e.g. 23..8)
  return hour >= startHour || hour < endHour;
}

export function urgentMayPassQuietHours(
  trigger: Trigger,
  state: HeartbeatState,
  now: number,
): boolean {
  if (trigger.interruptibility !== 'urgent') return false;
  if (!state.urgentPassesQuietHours) return false;
  if (!trigger.deadlineWithinHour) return false;
  return true;
}

export function isWithinQuietHours(
  now: number,
  state: HeartbeatState,
  trigger: Trigger,
  quietStartHour: number,
  quietEndHour: number,
): { blocked: boolean; reason: string } {
  if (!isQuietHour(now, quietStartHour, quietEndHour)) {
    return { blocked: false, reason: '' };
  }
  if (urgentMayPassQuietHours(trigger, state, now)) {
    return { blocked: false, reason: 'urgent-passes' };
  }
  return {
    blocked: true,
    reason: `Quiet hours (${pad(quietStartHour)}:00–${pad(quietEndHour)}:00)`,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}