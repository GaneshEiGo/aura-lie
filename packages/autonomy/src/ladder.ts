// === FILE START ===
// packages/autonomy/src/ladder.ts
// PRD §10.2 · §10.11 · F-080 · F-101 · T-10.
//
// The four autonomy levels from PRD §10.2. Default is Silent (0). Onboarding
// recommends Whisper (1). Levels 4 and 5 from earlier drafts (unattended
// missions) are out of scope for v1.
//
// Hard rules enforced here:
//   · Global hard cap of 6 notes a day applies at every level.
//   · Levels 1/2/3 have notes caps 2 / 4 / 6.
//   · Energy budgets (background model calls): 10 / 40 / 60.
//   · Upgrade (lower → higher) requires explicit user opt-in.
//   · Downgrade (higher → lower) is always allowed.
//   · A no-op transition is always allowed.

export type AutonomyLevel = 0 | 1 | 2 | 3;

export interface AutonomyLevelSpec {
  readonly level: AutonomyLevel;
  readonly name: 'Silent' | 'Whisper' | 'Prepare' | 'Act with approval';
  readonly description: string;
  readonly notesCapPerDay: number;
  readonly energyBudgetPerDay: number;
}

export const AUTONOMY_LEVELS: Readonly<Record<AutonomyLevel, AutonomyLevelSpec>> = Object.freeze({
  0: {
    level: 0,
    name: 'Silent',
    description: 'Nothing unless you ask.',
    notesCapPerDay: 0,
    energyBudgetPerDay: 0,
  },
  1: {
    level: 1,
    name: 'Whisper',
    description:
      'Notes only about things you set up: reminders, follow-ups you asked for, a daily brief you turned on.',
    notesCapPerDay: 2,
    energyBudgetPerDay: 10,
  },
  2: {
    level: 2,
    name: 'Prepare',
    description:
      'Level 1, plus background research and drafts on open loops you approved. Notifies when ready. Never sends, deletes or executes outside Aura-lie.',
    notesCapPerDay: 4,
    energyBudgetPerDay: 40,
  },
  3: {
    level: 3,
    name: 'Act with approval',
    description:
      'Level 2, plus proposes actions (create files, set reminders, run a check). Every action asks first unless its class is on your allow list. Irreversible actions always ask.',
    notesCapPerDay: 6,
    energyBudgetPerDay: 60,
  },
} as const);

export const GLOBAL_HARD_CAP = 6;
export const DEFAULT_LEVEL: AutonomyLevel = 0;
export const RECOMMENDED_LEVEL: AutonomyLevel = 1;

export class AutonomyTransitionError extends Error {
  readonly kind = 'AutonomyTransitionError';
  constructor(
    public readonly from: AutonomyLevel,
    public readonly to: AutonomyLevel,
    message: string,
  ) {
    super(message);
    this.name = 'AutonomyTransitionError';
  }
}

export interface TransitionOptions {
  /** Explicit user opt-in. Required for any upgrade. */
  userOptIn?: boolean;
}

export function isValidLevel(n: number): n is AutonomyLevel {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

/**
 * Validate a level transition.
 *  - downgrade (target < current): always allowed
 *  - no-op    (target == current): always allowed
 *  - upgrade  (target > current): requires opts.userOptIn === true
 */
export function validateTransition(
  current: AutonomyLevel,
  target: AutonomyLevel,
  opts: TransitionOptions = {},
): void {
  if (!isValidLevel(current)) {
    throw new AutonomyTransitionError(
      current, target, `current level ${String(current)} is not 0–3`,
    );
  }
  if (!isValidLevel(target)) {
    throw new AutonomyTransitionError(
      current, target, `target level ${String(target)} is not 0–3`,
    );
  }
  if (target === current) return;
  if (target < current) return;
  if (!opts.userOptIn) {
    throw new AutonomyTransitionError(
      current, target,
      `upgrade from ${current} to ${target} requires explicit user opt-in`,
    );
  }
}

export function getNotesCap(level: AutonomyLevel): number {
  return Math.min(AUTONOMY_LEVELS[level].notesCapPerDay, GLOBAL_HARD_CAP);
}

export function getEnergyBudget(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS[level].energyBudgetPerDay;
}

export interface DailyUsage {
  notesSentToday: number;
  energyUsedToday: number;
}

export type NoteDecisionReason =
  | 'ok'
  | 'cap-reached'
  | 'level-silent'
  | 'global-cap-reached';

export interface NoteSendDecision {
  allowed: boolean;
  reason: NoteDecisionReason;
  remaining: number;
  cap: number;
}

export function canSendNote(
  level: AutonomyLevel,
  usage: DailyUsage,
): NoteSendDecision {
  if (level === 0) {
    return { allowed: false, reason: 'level-silent', remaining: 0, cap: 0 };
  }
  const levelCap = getNotesCap(level);
  if (usage.notesSentToday >= GLOBAL_HARD_CAP) {
    return { allowed: false, reason: 'global-cap-reached', remaining: 0, cap: GLOBAL_HARD_CAP };
  }
  const remaining = Math.max(0, levelCap - usage.notesSentToday);
  if (remaining === 0) {
    return { allowed: false, reason: 'cap-reached', remaining: 0, cap: levelCap };
  }
  return { allowed: true, reason: 'ok', remaining, cap: levelCap };
}

export interface EnergyCheck {
  allowed: boolean;
  remaining: number;
  budget: number;
}

export function canUseEnergy(
  level: AutonomyLevel,
  usage: DailyUsage,
  requested: number,
): EnergyCheck {
  const budget = getEnergyBudget(level);
  const remaining = Math.max(0, budget - usage.energyUsedToday);
  if (requested <= 0) {
    return { allowed: true, remaining, budget };
  }
  return { allowed: remaining >= requested, remaining, budget };
}

export function getDefaultLevel(): AutonomyLevel { return DEFAULT_LEVEL; }
export function getRecommendedLevel(): AutonomyLevel { return RECOMMENDED_LEVEL; }

export function describeLevel(level: AutonomyLevel): AutonomyLevelSpec {
  return AUTONOMY_LEVELS[level];
}
// === FILE END ===