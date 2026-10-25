// === FILE START ===
// packages/autonomy/test/backup-reminder.test.ts
// FR-DATA-06 · F-214.

import { describe, it, expect } from 'vitest';
import {
  checkBackupReminder,
  markExported,
  markReminderShown,
  BACKUP_THRESHOLD_DAYS,
  type BackupState,
} from '../src/backup-reminder.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowAt = (offsetDays: number) => () => T0 + offsetDays * 86_400_000;
const iso = (offsetDays: number) => new Date(T0 + offsetDays * 86_400_000).toISOString();

describe('BACKUP_THRESHOLD_DAYS', () => {
  it('is 14 per FR-DATA-06', () => {
    expect(BACKUP_THRESHOLD_DAYS).toBe(14);
  });
});

describe('checkBackupReminder — no state', () => {
  it('null state never nudges', () => {
    const c = checkBackupReminder(null);
    expect(c.should_nudge).toBe(false);
    expect(c.reason).toBe('no-state');
  });
});

describe('checkBackupReminder — never exported', () => {
  it('null last_export_at with no reminder history → nudge', () => {
    const state: BackupState = { last_export_at: null, last_reminder_shown_at: null };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(true);
    expect(c.reason).toBe('never-exported');
    expect(c.days_since_export).toBeNull();
  });

  it('null last_export_at with recent reminder → no nudge (cooldown)', () => {
    const state: BackupState = {
      last_export_at: null,
      last_reminder_shown_at: iso(-0.5),
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(false);
    expect(c.reason).toBe('already-nudged-today');
  });

  it('null last_export_at with stale reminder → nudge again', () => {
    const state: BackupState = {
      last_export_at: null,
      last_reminder_shown_at: iso(-3),
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(true);
    expect(c.reason).toBe('never-exported');
  });
});

describe('checkBackupReminder — recent export', () => {
  it('13 days ago → no nudge', () => {
    const state: BackupState = {
      last_export_at: iso(-13),
      last_reminder_shown_at: null,
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(false);
    expect(c.reason).toBe('export-recent');
    expect(c.days_since_export).toBeCloseTo(13, 1);
  });

  it('exactly 14 days ago → nudge', () => {
    const state: BackupState = {
      last_export_at: iso(-14),
      last_reminder_shown_at: null,
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(true);
    expect(c.reason).toBe('nudge');
  });

  it('15 days ago → nudge', () => {
    const state: BackupState = {
      last_export_at: iso(-15),
      last_reminder_shown_at: null,
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(true);
    expect(c.reason).toBe('nudge');
  });

  it('15 days ago but nudged 0.5 days ago → no nudge (cooldown)', () => {
    const state: BackupState = {
      last_export_at: iso(-15),
      last_reminder_shown_at: iso(-0.5),
    };
    const c = checkBackupReminder(state, { now: nowAt(0) });
    expect(c.should_nudge).toBe(false);
    expect(c.reason).toBe('already-nudged-today');
  });
});

describe('markExported', () => {
  it('stamps last_export_at and clears reminder', () => {
    const state: BackupState = {
      last_export_at: iso(-20),
      last_reminder_shown_at: iso(-1),
    };
    const out = markExported(state, { now: nowAt(0) });
    expect(out.last_export_at).toBe(iso(0));
    expect(out.last_reminder_shown_at).toBeNull();
  });
});

describe('markReminderShown', () => {
  it('stamps last_reminder_shown_at', () => {
    const state: BackupState = { last_export_at: null, last_reminder_shown_at: null };
    const out = markReminderShown(state, { now: nowAt(0) });
    expect(out.last_reminder_shown_at).toBe(iso(0));
  });
});

describe('custom thresholds', () => {
  it('custom thresholdDays=3 honours the new threshold', () => {
    const state: BackupState = {
      last_export_at: iso(-5),
      last_reminder_shown_at: null,
    };
    const c = checkBackupReminder(state, { now: nowAt(0), thresholdDays: 3 });
    expect(c.should_nudge).toBe(true);
    expect(c.threshold_days).toBe(3);
  });

  it('custom cooldownDays=3 blocks re-nudge within 3 days', () => {
    const state: BackupState = {
      last_export_at: iso(-30),
      last_reminder_shown_at: iso(-2),
    };
    const c = checkBackupReminder(state, { now: nowAt(0), cooldownDays: 3 });
    expect(c.should_nudge).toBe(false);
    expect(c.reason).toBe('already-nudged-today');
  });
});
// === FILE END ===