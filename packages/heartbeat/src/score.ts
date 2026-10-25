// packages/heartbeat/src/score.ts
// PRD 10.5: send_score = R × U × N × (1 − Fa) × K
//           Fa = max(notes_today / cap, ignored_rate_7d)

import type {
  HeartbeatState,
  RecentNote,
  SendScore,
  Trigger,
} from './types.js';
import { LEVEL_CAPS, LEVEL_THRESHOLDS } from './types.js';

export function computeFatigue(
  notesToday: number,
  cap: number,
  recentNotes: RecentNote[],
): number {
  const capTerm = cap > 0 ? Math.min(1, notesToday / cap) : 1;
  const total = recentNotes.length;
  const ignored = recentNotes.filter((n) => n.ignored).length;
  const ignoredTerm = total > 0 ? ignored / total : 0;
  return Math.max(capTerm, ignoredTerm);
}

export function computeSendScore(
  trigger: Trigger,
  state: HeartbeatState,
): SendScore {
  const cap = LEVEL_CAPS[state.level] || 1;
  const threshold =
    state.level === 0 ? Number.POSITIVE_INFINITY : LEVEL_THRESHOLDS[state.level];

  const fatigue = computeFatigue(state.notesToday, cap, state.recentNotes);
  const consent = trigger.consent ? 1 : 0;
  const raw =
    clamp01(trigger.relevance) *
    clamp01(trigger.urgency) *
    clamp01(trigger.novelty) *
    (1 - fatigue) *
    consent;

  return {
    relevance: trigger.relevance,
    urgency: trigger.urgency,
    novelty: trigger.novelty,
    fatigue,
    consent,
    raw,
    threshold,
    passes: consent > 0 && raw >= threshold,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}