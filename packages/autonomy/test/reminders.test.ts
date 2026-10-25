// === FILE START ===
// packages/autonomy/test/reminders.test.ts
// PRD §10.7 · F-091 · FR-TOOL-02.
//
// Fix history: two snooze-then-fire tests previously set untilIso equal to
// the injected clock (T0), which correctly tripped the guard
// "untilIso must be in the future". Corrected to a +1-hour snooze target
// and a +1-hour +1-second fire clock.

import { describe, it, expect } from 'vitest';
import {
  createReminder,
  fireDueReminders,
  snoozeReminder,
  dismissReminder,
} from '../src/reminders.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowAt = (offsetMs: number) => () => T0 + offsetMs;

function fixedId(): () => string {
  let n = 0;
  return () => `rem-${++n}`;
}

describe('createReminder', () => {
  it('creates a pending time reminder', () => {
    const r = createReminder({
      text: 'Buy milk',
      due_at: '2026-10-02T14:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(r.status).toBe('pending');
    expect(r.kind).toBe('time');
    expect(r.fired_at).toBeNull();
    expect(r.snoozed_until).toBeNull();
    expect(r.context).toBeNull();
  });

  it('accepts kind and context', () => {
    const r = createReminder({
      text: 'Interview follow-up',
      due_at: '2026-10-03T10:00:00Z',
      kind: 'follow-up',
      context: 'They interviewed Tuesday',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(r.kind).toBe('follow-up');
    expect(r.context).toBe('They interviewed Tuesday');
  });
});

describe('fireDueReminders', () => {
  it('fires pending reminders whose due_at is in the past', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const out = fireDueReminders([r], { now: nowAt(1000) });
    expect(out.due.length).toBe(1);
    expect(out.due[0]!.status).toBe('fired');
    expect(out.due[0]!.fired_at).toBe(new Date(T0 + 1000).toISOString());
    expect(out.remaining.length).toBe(0);
  });

  it('does not fire reminders whose due_at is in the future', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T15:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const out = fireDueReminders([r], { now: nowAt(1000) });
    expect(out.due.length).toBe(0);
    expect(out.remaining.length).toBe(1);
  });

  it('fires snoozed reminders whose snoozed_until is in the past', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const snoozed = snoozeReminder(r, '2026-10-02T12:00:01Z', { now: nowAt(0) });
    const out = fireDueReminders([snoozed], {
      now: () => Date.parse('2026-10-02T12:00:02Z'),
    });
    expect(out.due.length).toBe(1);
    expect(out.due[0]!.status).toBe('fired');
    expect(out.due[0]!.snoozed_until).toBeNull();
  });

  it('ignores dismissed and already-fired reminders', () => {
    const fired = {
      ...createReminder({
        text: 'a',
        due_at: '2026-10-02T11:00:00Z',
        now: nowAt(0),
        idFactory: fixedId(),
      }),
      status: 'fired' as const,
      fired_at: new Date(T0).toISOString(),
    };
    const dismissed = dismissReminder(
      createReminder({
        text: 'b',
        due_at: '2026-10-02T11:00:00Z',
        now: nowAt(0),
        idFactory: fixedId(),
      }),
    );
    const out = fireDueReminders([fired, dismissed], { now: nowAt(1000) });
    expect(out.due.length).toBe(0);
    expect(out.remaining.length).toBe(2);
  });
});

describe('snoozeReminder', () => {
  it('transitions pending → snoozed with a future timestamp', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const s = snoozeReminder(r, '2026-10-02T13:00:00Z', { now: nowAt(0) });
    expect(s.status).toBe('snoozed');
    expect(s.snoozed_until).toBe('2026-10-02T13:00:00Z');
  });

  it('throws on fired reminders', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const fired = fireDueReminders([r], { now: nowAt(1000) }).due[0]!;
    expect(() => snoozeReminder(fired, '2026-10-02T13:00:00Z')).toThrow();
  });

  it('throws if untilIso is in the past', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T14:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(() => snoozeReminder(r, '2026-10-02T11:00:00Z', { now: nowAt(0) })).toThrow();
  });

  it('throws if untilIso equals now (not strictly future)', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T14:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(() =>
      snoozeReminder(r, '2026-10-02T12:00:00Z', { now: nowAt(0) }),
    ).toThrow(/future/);
  });
});

describe('dismissReminder', () => {
  it('sets status to dismissed and clears snooze', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const d = dismissReminder(r);
    expect(d.status).toBe('dismissed');
    expect(d.snoozed_until).toBeNull();
  });
});

describe('fireDueReminders integration', () => {
  it('mixed statuses — only pending+overdue fires', () => {
    const overdue = createReminder({
      text: 'overdue',
      due_at: '2026-10-02T10:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const future = createReminder({
      text: 'future',
      due_at: '2026-10-02T23:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const dismissed = dismissReminder(
      createReminder({
        text: 'dismissed',
        due_at: '2026-10-02T10:00:00Z',
        now: nowAt(0),
        idFactory: fixedId(),
      }),
    );
    const out = fireDueReminders([overdue, future, dismissed], { now: nowAt(1000) });
    expect(out.due.length).toBe(1);
    expect(out.due[0]!.text).toBe('overdue');
    expect(out.remaining.length).toBe(2);
  });

  it('snooze then fire — round trip (snooze target must be strictly future)', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    // Snooze target is 1 hour in the future from T0.
    const s = snoozeReminder(r, '2026-10-02T13:00:00Z', { now: nowAt(0) });
    // Fire 1 second after the snooze target.
    const out = fireDueReminders([s], { now: () => Date.parse('2026-10-02T13:00:01Z') });
    expect(out.due.length).toBe(1);
    expect(out.due[0]!.status).toBe('fired');
  });

  it('preserves identity across snooze', () => {
    const r = createReminder({
      text: 'x',
      due_at: '2026-10-02T11:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const s = snoozeReminder(r, '2026-10-02T13:00:00Z', { now: nowAt(0) });
    expect(s.id).toBe(r.id);
  });
});
// === FILE END ===