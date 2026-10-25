// packages/heartbeat/src/types.ts
// PRD 10.4, 10.5, 5.18. Every type maps to a named row in the PRD.

export type AutonomyLevel = 0 | 1 | 2 | 3;

export type Interruptibility =
  | 'urgent'
  | 'important'
  | 'when_convenient'
  | 'not_worth_it';

export interface Trigger {
  id: string;
  topic: string;
  relevance: number; // R, PRD 10.5: 0..1
  urgency: number;   // U, PRD 10.5: 0..1
  novelty: number;   // N, PRD 10.5: 0..1
  consent: boolean;  // K, PRD 10.5: 0 or 1
  interruptibility: Interruptibility; // PRD 10.5 Interruptibility classes
  reason: string;
  projectId?: string;
  deadlineWithinHour?: boolean;
}

export interface RecentNote {
  topic: string;
  at: number;
  ignored: boolean;
}

export interface HeartbeatState {
  level: AutonomyLevel;
  notesToday: number;
  dayStart: number;
  recentNotes: RecentNote[];
  killSwitchActive: boolean;
  urgentPassesQuietHours: boolean;
}

export interface SendScore {
  relevance: number;
  urgency: number;
  novelty: number;
  fatigue: number;
  consent: number;
  raw: number;
  threshold: number;
  passes: boolean;
}

export type BlockReason =
  | 'kill_switch'
  | 'level_silent'
  | 'cap_reached'
  | 'cooldown'
  | 'quiet_hours'
  | 'score';

export interface ComposeDecision {
  compose: boolean;
  reason: string;
  score: SendScore;
  blockedBy?: BlockReason;
}

export interface HeartbeatOptions {
  clock?: { now(): number };
  quietStartHour?: number; // PRD 10.5: default 23
  quietEndHour?: number;   // PRD 10.5: default 8
  globalHardCap?: number;  // PRD 10.2: default 6
  cooldownHours?: number;  // PRD 10.5: default 24
}

// PRD 10.2: cap per level.
export const LEVEL_CAPS: Record<AutonomyLevel, number> = {
  0: 0,
  1: 2,
  2: 4,
  3: 6,
};

// PRD 10.5: thresholds per level.
export const LEVEL_THRESHOLDS: Record<Exclude<AutonomyLevel, 0>, number> = {
  1: 0.55,
  2: 0.45,
  3: 0.4,
};