// === FILE START ===
// packages/autonomy/src/reminders.ts
// PRD §10.7 · F-091 · FR-TOOL-02.
//
// Time-based and follow-up reminders. A 'follow-up' reminder is created
// automatically 24 hours after a user-mentioned dated event ("interview
// Tuesday"). Time-based reminders fire at their due time. Snooze defers to a
// future timestamp; dismiss sets terminal state.

export type ReminderKind = 'time' | 'follow-up' | 'context';

export type ReminderStatus = 'pending' | 'fired' | 'snoozed' | 'dismissed';

export interface Reminder {
  id: string;
  text: string;
  due_at: string;
  kind: ReminderKind;
  status: ReminderStatus;
  snoozed_until: string | null;
  context: string | null;
  created_at: string;
  fired_at: string | null;
}

export interface CreateReminderInput {
  text: string;
  due_at: string;
  kind?: ReminderKind;
  context?: string | null;
  now?: () => number;
  idFactory?: () => string;
}

export function createReminder(input: CreateReminderInput): Reminder {
  const now = input.now ?? Date.now;
  const iso = new Date(now()).toISOString();
  const id = input.idFactory
    ? input.idFactory()
    : `rem-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    text: input.text,
    due_at: input.due_at,
    kind: input.kind ?? 'time',
    status: 'pending',
    snoozed_until: null,
    context: input.context ?? null,
    created_at: iso,
    fired_at: null,
  };
}

export interface FireDueResult {
  due: Reminder[];
  remaining: Reminder[];
}

export function fireDueReminders(
  reminders: Reminder[],
  opts: { now?: () => number } = {},
): FireDueResult {
  const now = (opts.now ?? Date.now)();
  const due: Reminder[] = [];
  const remaining: Reminder[] = [];

  for (const r of reminders) {
    if (r.status === 'pending' && Date.parse(r.due_at) <= now) {
      due.push({ ...r, status: 'fired', fired_at: new Date(now).toISOString() });
    } else if (
      r.status === 'snoozed' &&
      r.snoozed_until !== null &&
      Date.parse(r.snoozed_until) <= now
    ) {
      due.push({
        ...r,
        status: 'fired',
        fired_at: new Date(now).toISOString(),
        snoozed_until: null,
      });
    } else {
      remaining.push(r);
    }
  }
  return { due, remaining };
}

export function snoozeReminder(
  reminder: Reminder,
  untilIso: string,
  opts: { now?: () => number } = {},
): Reminder {
  if (reminder.status !== 'pending' && reminder.status !== 'snoozed') {
    throw new Error(
      `snoozeReminder: cannot snooze a ${reminder.status} reminder`,
    );
  }
  if (Date.parse(untilIso) <= (opts.now ?? Date.now)()) {
    throw new Error('snoozeReminder: untilIso must be in the future');
  }
  return { ...reminder, status: 'snoozed', snoozed_until: untilIso };
}

export function dismissReminder(reminder: Reminder): Reminder {
  return { ...reminder, status: 'dismissed', snoozed_until: null };
}
// === FILE END ===