// === FILE START ===
// packages/agents/src/one-sentence-v2.ts
// PRD §10.9 · FR-AGENT-07 · F-102 · T-13.
//
// One-sentence agent parser. Deterministic regex extraction. No model call.
// No external imports. Turns a natural-language request such as
//   "Every Monday, tell me what changed in my project"
// into a structured AgentSpec (schedule + action + target) plus a one-line
// confirmation card. Anything not matching a supported phrasing is rejected
// with a hint, rather than guessed at.
//
// Supported phrasings:
//   Every day [,] <action> <target>
//   Every <weekday> [,] <action> <target>
//   Every month [,] <action> <target>
//   (any of the above, optionally) at HH:MM before the comma
//
// Actions:
//   "tell me what changed in X" → report-changes
//   "summarise X" / "summarize X" → summarise
//   "remind me to review X"    → remind

export type Frequency = 'daily' | 'weekly' | 'monthly';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type AgentAction = 'report-changes' | 'summarise' | 'remind';

export interface ScheduleSpec {
  frequency: Frequency;
  weekday?: Weekday;
  /** "HH:MM" 24-hour. Defaults to "09:00". */
  timeOfDay: string;
  /** Defaults to "UTC". */
  timezone: string;
}

export interface AgentSpec {
  schedule: ScheduleSpec;
  action: AgentAction;
  target: string;
  raw: string;
  confirmation: string;
}

export type ParseResult =
  | { ok: true; spec: AgentSpec }
  | { ok: false; reason: string };

const WEEKDAYS: readonly Weekday[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export const DEFAULT_TIME = '09:00';
export const DEFAULT_TIMEZONE = 'UTC';

// "every <day|weekday|month>[,] <action> <target>"
// Optional " at HH:MM" before the separator. Case-insensitive.
const PATTERN =
  /^\s*every\s+(?<when>day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|month)(?:\s+at\s+(?<hour>\d{1,2}):(?<minute>\d{2}))?\s*,?\s+(?<action>tell\s+me\s+what\s+changed\s+in|summarise|summarize|remind\s+me\s+to\s+review)\s+(?<target>.+?)\.?\s*$/i;

function normaliseAction(raw: string): AgentAction | null {
  const a = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (a.startsWith('tell me what changed in')) return 'report-changes';
  if (a === 'summarise' || a === 'summarize') return 'summarise';
  if (a === 'remind me to review') return 'remind';
  return null;
}

function makeConfirmation(spec: Omit<AgentSpec, 'confirmation' | 'raw'>): string {
  let when: string;
  switch (spec.schedule.frequency) {
    case 'daily':
      when = 'Every day';
      break;
    case 'weekly':
      when = `Every ${
        spec.schedule.weekday!.charAt(0).toUpperCase() + spec.schedule.weekday!.slice(1)
      }`;
      break;
    case 'monthly':
      when = 'Every month';
      break;
  }
  const actionWords =
    spec.action === 'report-changes'
      ? 'report what changed in'
      : spec.action === 'summarise'
      ? 'summarise'
      : 'remind you to review';
  return (
    `${when} at ${spec.schedule.timeOfDay} ${spec.schedule.timezone}, ` +
    `I will ${actionWords} "${spec.target}". Nothing runs until you confirm.`
  );
}

export function parseOneSentence(input: string): ParseResult {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'input must be a string' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'input is empty' };
  }

  const m = PATTERN.exec(trimmed);
  if (!m || !m.groups) {
    return {
      ok: false,
      reason:
        'unsupported phrasing. Try: "Every Monday, tell me what changed in X", ' +
        '"Every day, summarise Y", or ' +
        '"Every Friday at 17:00, remind me to review Z".',
    };
  }

  const when = m.groups['when']!.toLowerCase();
  const actionRaw = m.groups['action']!;
  const target = m.groups['target']!.trim();

  const action = normaliseAction(actionRaw);
  if (action === null) {
    return { ok: false, reason: `unknown action: "${actionRaw}"` };
  }

  let frequency: Frequency;
  let weekday: Weekday | undefined;
  if (when === 'day') {
    frequency = 'daily';
  } else if (when === 'month') {
    frequency = 'monthly';
  } else if ((WEEKDAYS as readonly string[]).includes(when)) {
    frequency = 'weekly';
    weekday = when as Weekday;
  } else {
    return { ok: false, reason: `unknown frequency word: "${when}"` };
  }

  let timeOfDay = DEFAULT_TIME;
  if (m.groups['hour'] !== undefined && m.groups['minute'] !== undefined) {
    const hour = Number(m.groups['hour']);
    const minute = Number(m.groups['minute']);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { ok: false, reason: `hour must be 0-23, got ${hour}` };
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return { ok: false, reason: `minute must be 0-59, got ${minute}` };
    }
    timeOfDay = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  if (target.length === 0) {
    return { ok: false, reason: 'target is empty' };
  }

  const head: Omit<AgentSpec, 'confirmation' | 'raw'> = {
    schedule: {
      frequency,
      ...(weekday ? { weekday } : {}),
      timeOfDay,
      timezone: DEFAULT_TIMEZONE,
    },
    action,
    target,
  };

  return {
    ok: true,
    spec: {
      ...head,
      raw: trimmed,
      confirmation: makeConfirmation(head),
    },
  };
}
// === FILE END ===