// === FILE START ===
// packages/proactive/src/heartbeat-v2.ts
// PRD 10.2 · 10.5 · FR-PRO-01 to FR-PRO-12 · T-26.
//
// The heartbeat. A deterministic scorer that decides whether Aura-lie
// should proactively message the user. No model call unless the decision
// is "send".
//
// PRD 10.5 send score formula:
//   send_score = R × U × N × (1 − Fa) × K
//   R  = relevance to active project or goal, 0..1
//   U  = urgency from deadlines or state change, 0..1
//   N  = novelty since the last note on this topic, 0..1
//   Fa = fatigue = max(notes_today/cap, ignored_rate_7d)
//   K  = consent for this trigger type, 0 or 1
//
// Thresholds per PRD 10.5:
//   Level 1 >= 0.55
//   Level 2 >= 0.45
//   Level 3 >= 0.40
//
// Caps per PRD 10.2:
//   Level 0 = 0/day
//   Level 1 ≤ 2/day
//   Level 2 ≤ 4/day
//   Level 3 ≤ 6/day
//   Hard cap = 6/day at every level
//
// Block gates (in order):
//   1. Level 0 → silent
//   2. No consent for this trigger → block
//   3. Quiet hours (unless urgent + opt-in) → block
//   4. notesToday >= cap → block
//   5. Same topic within cooldown → block
//   6. send_score < threshold → block
//   → SEND

export type AutonomyLevel = 0 | 1 | 2 | 3;

export type TriggerType =
  | 'reminder'
  | 'deadline'
  | 'open_loop'
  | 'project_change'
  | 'promise_completed'
  | 'watched_source'
  | 'follow_up';

export interface Signal {
  triggerType: TriggerType;
  topicId: string;
  relevance: number; // 0..1
  urgency: number;   // 0..1
  novelty: number;   // 0..1
}

export interface HeartbeatState {
  level: AutonomyLevel;
  nowMs: number;
  localHour: number; // 0..23
  notesToday: number;
  ignoreRate7d: number; // 0..1
  lastNoteOnTopicMs: Map<string, number>;
  consentByTrigger: Record<TriggerType, boolean>;
}

export interface HeartbeatOptions {
  quietHoursStart: number;
  quietHoursEnd: number;
  topicCooldownMs: number;
  urgentPassesQuietHours: boolean;
}

export interface SendScoreFactors {
  relevance: number;
  urgency: number;
  novelty: number;
  fatigue: number;
  consent: number;
}

export interface HeartbeatDecision {
  send: boolean;
  reason: string;
  score: number;
  factors: SendScoreFactors;
  threshold: number;
  blockReason?:
    | 'level 0'
    | 'consent'
    | 'quiet hours'
    | 'daily cap'
    | 'cooldown'
    | 'threshold';
}

// -----------------------------------------------------------------------------
// Constants (PRD 10.2 · 10.5)
// -----------------------------------------------------------------------------

export const AUTONOMY_CAPS: Record<AutonomyLevel, number> = {
  0: 0,
  1: 2,
  2: 4,
  3: 6,
};

export const LEVEL_THRESHOLDS: Record<AutonomyLevel, number> = {
  0: 1.1, // level 0 never sends
  1: 0.55,
  2: 0.45,
  3: 0.40,
};

export const HARD_DAILY_CAP = 6;
export const DEFAULT_QUIET_START = 23;
export const DEFAULT_QUIET_END = 8;
export const DEFAULT_TOPIC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const URGENT_THRESHOLD = 0.9;

const DEFAULTS: HeartbeatOptions = {
  quietHoursStart: DEFAULT_QUIET_START,
  quietHoursEnd: DEFAULT_QUIET_END,
  topicCooldownMs: DEFAULT_TOPIC_COOLDOWN_MS,
  urgentPassesQuietHours: false,
};

// -----------------------------------------------------------------------------
// Quiet hours helper
// -----------------------------------------------------------------------------

export function isInQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  // wraps midnight
  return hour >= start || hour < end;
}

// -----------------------------------------------------------------------------
// decideHeartbeat
// -----------------------------------------------------------------------------

export function decideHeartbeat(
  signal: Signal,
  state: HeartbeatState,
  opts: Partial<HeartbeatOptions> = {},
): HeartbeatDecision {
  const o: HeartbeatOptions = { ...DEFAULTS, ...opts };
  const cap = AUTONOMY_CAPS[state.level];
  const threshold = LEVEL_THRESHOLDS[state.level];
  const factors: SendScoreFactors = {
    relevance: 0,
    urgency: 0,
    novelty: 0,
    fatigue: 0,
    consent: 0,
  };

  // Gate 1: level 0 = silent
  if (state.level === 0) {
    return {
      send: false,
      reason: 'silent mode (level 0)',
      score: 0,
      factors,
      threshold,
      blockReason: 'level 0',
    };
  }

  // Gate 2: consent
  if (!state.consentByTrigger[signal.triggerType]) {
    return {
      send: false,
      reason: 'no consent for this trigger',
      score: 0,
      factors,
      threshold,
      blockReason: 'consent',
    };
  }
  factors.consent = 1;

  // Gate 3: quiet hours
  const urgent = signal.urgency >= URGENT_THRESHOLD;
  if (isInQuietHours(state.localHour, o.quietHoursStart, o.quietHoursEnd)) {
    if (!(urgent && o.urgentPassesQuietHours)) {
      return {
        send: false,
        reason: 'quiet hours',
        score: 0,
        factors,
        threshold,
        blockReason: 'quiet hours',
      };
    }
  }

  // Gate 4: daily cap
  if (state.notesToday >= cap) {
    return {
      send: false,
      reason: `daily cap reached (${cap})`,
      score: 0,
      factors,
      threshold,
      blockReason: 'daily cap',
    };
  }

  // Gate 5: topic cooldown
  const lastOnTopic = state.lastNoteOnTopicMs.get(signal.topicId) ?? -Infinity;
  if (state.nowMs - lastOnTopic < o.topicCooldownMs) {
    return {
      send: false,
      reason: `topic cooldown (${signal.topicId})`,
      score: 0,
      factors,
      threshold,
      blockReason: 'cooldown',
    };
  }

  // Compute send score
  const fatigue = Math.max(state.notesToday / cap, state.ignoreRate7d);
  factors.relevance = signal.relevance;
  factors.urgency = signal.urgency;
  factors.novelty = signal.novelty;
  factors.fatigue = fatigue;

  const score =
    signal.relevance * signal.urgency * signal.novelty * (1 - fatigue) * 1;

  // Gate 6: threshold
  if (score >= threshold) {
    return { send: true, reason: 'passes all gates', score, factors, threshold };
  }
  return {
    send: false,
    reason: `score ${score.toFixed(3)} < threshold ${threshold}`,
    score,
    factors,
    threshold,
    blockReason: 'threshold',
  };
}

// -----------------------------------------------------------------------------
// 30-day simulation
// -----------------------------------------------------------------------------

export interface SimulationEvent {
  day: number;      // 0-based, 0..29
  hourUtc: number;  // 0..23 (treated as local for the test)
  signal: Signal;
  willBeIgnored?: boolean;
}

export interface SimulationResult {
  totalNotesSent: number;
  capViolations: number;
  quietHourViolations: number;
  maxNotesInADay: number;
  perDay: number[];
  decisions: Array<{ event: SimulationEvent; decision: HeartbeatDecision }>;
}

const ALL_TRIGGERS: TriggerType[] = [
  'reminder',
  'deadline',
  'open_loop',
  'project_change',
  'promise_completed',
  'watched_source',
  'follow_up',
];

export function simulate30Days(
  events: SimulationEvent[],
  level: AutonomyLevel,
  opts: Partial<HeartbeatOptions> = {},
): SimulationResult {
  const o: HeartbeatOptions = { ...DEFAULTS, ...opts };
  const cap = AUTONOMY_CAPS[level];

  const sorted = [...events].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    return a.hourUtc - b.hourUtc;
  });

  const perDay: number[] = new Array(30).fill(0);
  const decisions: Array<{ event: SimulationEvent; decision: HeartbeatDecision }> = [];
  const ignoreHistory: Array<{ day: number; ignored: boolean }> = [];
  const lastNoteOnTopicMs = new Map<string, number>();
  const consentByTrigger = {} as Record<TriggerType, boolean>;
  for (const t of ALL_TRIGGERS) consentByTrigger[t] = true;

  let totalNotesSent = 0;
  let capViolations = 0;
  let quietHourViolations = 0;
  let currentDay = -1;
  let notesToday = 0;

  for (const ev of sorted) {
    if (ev.day !== currentDay) {
      currentDay = ev.day;
      notesToday = 0;
    }

    const nowMs = ev.day * 24 * 60 * 60 * 1000 + ev.hourUtc * 60 * 60 * 1000;

    const windowStart = ev.day - 6;
    const inWindow = ignoreHistory.filter(
      (h) => h.day >= windowStart && h.day <= ev.day,
    );
    const ignoreRate7d =
      inWindow.length === 0
        ? 0
        : inWindow.filter((h) => h.ignored).length / inWindow.length;

    const state: HeartbeatState = {
      level,
      nowMs,
      localHour: ev.hourUtc,
      notesToday,
      ignoreRate7d,
      lastNoteOnTopicMs,
      consentByTrigger,
    };

    const decision = decideHeartbeat(ev.signal, state, o);
    decisions.push({ event: ev, decision });

    if (decision.send) {
      // Count violations BEFORE incrementing
      if (notesToday >= cap) capViolations++;
      if (isInQuietHours(ev.hourUtc, o.quietHoursStart, o.quietHoursEnd)) {
        const urgent = ev.signal.urgency >= URGENT_THRESHOLD;
        if (!(urgent && o.urgentPassesQuietHours)) {
          quietHourViolations++;
        }
      }
      notesToday++;
      perDay[ev.day]++;
      totalNotesSent++;
      lastNoteOnTopicMs.set(ev.signal.topicId, nowMs);
      ignoreHistory.push({ day: ev.day, ignored: ev.willBeIgnored ?? false });
    }
  }

  const maxNotesInADay = perDay.reduce((m, v) => (v > m ? v : m), 0);
  return {
    totalNotesSent,
    capViolations,
    quietHourViolations,
    maxNotesInADay,
    perDay,
    decisions,
  };
}
// === FILE END ===