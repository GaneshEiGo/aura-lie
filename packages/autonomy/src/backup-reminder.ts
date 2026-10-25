// === FILE START ===
// packages/autonomy/src/backup-reminder.ts
// FR-DATA-06 · F-214 · PRD §4.5.
//
// Browsers can clear storage, so export reminders are mandatory (PRD §4.5).
// Threshold: 14 days since the last Full export (FR-DATA-06).
// Anti-nag: at most one nudge per day (cooldownDays).

export const BACKUP_THRESHOLD_DAYS = 14;

export interface BackupState {
  last_export_at: string | null;
  last_reminder_shown_at: string | null;
}

export type BackupReason =
  | 'nudge'
  | 'export-recent'
  | 'never-exported'
  | 'already-nudged-today'
  | 'no-state';

export interface BackupCheck {
  should_nudge: boolean;
  days_since_export: number | null;
  days_since_last_reminder: number | null;
  threshold_days: number;
  reason: BackupReason;
}

export interface CheckBackupOptions {
  now?: () => number;
  thresholdDays?: number;
  cooldownDays?: number;
}

export function checkBackupReminder(
  state: BackupState | null,
  opts: CheckBackupOptions = {},
): BackupCheck {
  const threshold = opts.thresholdDays ?? BACKUP_THRESHOLD_DAYS;
  const cooldownDays = opts.cooldownDays ?? 1;
  const now = (opts.now ?? Date.now)();

  if (!state) {
    return {
      should_nudge: false,
      days_since_export: null,
      days_since_last_reminder: null,
      threshold_days: threshold,
      reason: 'no-state',
    };
  }

  // Never exported → nudge unless we already nudged within the cooldown.
  if (!state.last_export_at) {
    if (state.last_reminder_shown_at) {
      const sinceReminder =
        (now - Date.parse(state.last_reminder_shown_at)) / 86_400_000;
      if (sinceReminder < cooldownDays) {
        return {
          should_nudge: false,
          days_since_export: null,
          days_since_last_reminder: sinceReminder,
          threshold_days: threshold,
          reason: 'already-nudged-today',
        };
      }
      return {
        should_nudge: true,
        days_since_export: null,
        days_since_last_reminder: sinceReminder,
        threshold_days: threshold,
        reason: 'never-exported',
      };
    }
    return {
      should_nudge: true,
      days_since_export: null,
      days_since_last_reminder: null,
      threshold_days: threshold,
      reason: 'never-exported',
    };
  }

  const daysSinceExport =
    (now - Date.parse(state.last_export_at)) / 86_400_000;
  if (daysSinceExport < threshold) {
    return {
      should_nudge: false,
      days_since_export: daysSinceExport,
      days_since_last_reminder: state.last_reminder_shown_at
        ? (now - Date.parse(state.last_reminder_shown_at)) / 86_400_000
        : null,
      threshold_days: threshold,
      reason: 'export-recent',
    };
  }

  if (state.last_reminder_shown_at) {
    const sinceReminder =
      (now - Date.parse(state.last_reminder_shown_at)) / 86_400_000;
    if (sinceReminder < cooldownDays) {
      return {
        should_nudge: false,
        days_since_export: daysSinceExport,
        days_since_last_reminder: sinceReminder,
        threshold_days: threshold,
        reason: 'already-nudged-today',
      };
    }
  }

  return {
    should_nudge: true,
    days_since_export: daysSinceExport,
    days_since_last_reminder: state.last_reminder_shown_at
      ? (now - Date.parse(state.last_reminder_shown_at)) / 86_400_000
      : null,
    threshold_days: threshold,
    reason: 'nudge',
  };
}

export function markReminderShown(
  state: BackupState,
  opts: { now?: () => number } = {},
): BackupState {
  return {
    ...state,
    last_reminder_shown_at: new Date((opts.now ?? Date.now)()).toISOString(),
  };
}

export function markExported(
  state: BackupState,
  opts: { now?: () => number } = {},
): BackupState {
  return {
    ...state,
    last_export_at: new Date((opts.now ?? Date.now)()).toISOString(),
    last_reminder_shown_at: null,
  };
}
// === FILE END ===