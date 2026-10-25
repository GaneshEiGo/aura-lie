// packages/kill-switch-audit/src/types.ts
// PRD 10.10, 12.7, F-082, F-083, F-285, T-10.

/**
 * PRD 10.10: "Every autonomous action writes a row."
 * PRD 12.7:   "A failed Cost Guard attempt writes COST_GUARD_VIOLATION here."
 * PRD 10.4:   "…checks the kill switch flag and exits."
 */
export type AuditAction =
  | 'kill_switch_pause'
  | 'kill_switch_resume'
  | 'compose_note'
  | 'compose_blocked'
  | 'mission_step'
  | 'mission_blocked'
  | 'tool_call'
  | 'tool_blocked'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'memory_write'
  | 'memory_forget'
  | 'export'
  | 'wipe'
  | 'cost_guard_violation';

export type AuditResult =
  | 'success'
  | 'failure'
  | 'blocked'
  | 'rejected'
  | 'queued';

/** PRD 10.10: exact column set. Plus `prevHash` + `hash` (F-285). */
export interface AuditEntry {
  id: string;
  at: number;
  action: AuditAction;
  actor: string;
  /** "WHY" — one-sentence reason the action was taken (PRD 10.10). */
  reason: string;
  /** "INPUT" — SHA-256 of the action's input payload, never the payload itself. */
  inputHash: string;
  /** "TOOL" — tool id when relevant; empty string otherwise. */
  tool: string;
  /** "OUTPUT" — one-line summary of the outcome (never full payload). */
  outputSummary: string;
  /** "RESULT" — success / failure / blocked / rejected / queued. */
  result: AuditResult;
  /** "APPROVALS" — the approval cards a user has granted, if any. */
  approvals: string[];
  /** F-285: hash of the previous entry (GENESIS for the first). */
  prevHash: string;
  /** F-285: SHA-256 of the canonical serialisation of this row (without `hash`). */
  hash: string;
}

/** Fields required when recording an entry. */
export interface AuditInput {
  action: AuditAction;
  actor: string;
  reason: string;
  /** Will be canonicalized + hashed. Never stored raw. */
  inputPayload?: unknown;
  tool?: string;
  outputSummary?: string;
  result?: AuditResult;
  approvals?: string[];
  /** For tests / fixed clock. */
  at?: number;
}

export interface ChainVerifyResult {
  valid: boolean;
  count: number;
  brokenAt?: string;
  reason?: string;
}

/** PRD 10.10: 400-day retention. */
export const AUDIT_RETENTION_DAYS = 400;

/** F-285: the hash of the entry before any were written. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * KillSwitchState — the persisted flag (one row per profile in D1).
 * PRD 10.4: "A flag in D1."
 */
export interface KillSwitchState {
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  reason: string | null;
}

export interface KillSwitchOptions {
  initial?: Partial<KillSwitchState>;
  clock?: { now(): number };
  /** Audit sink — optional. When provided, pause/resume are auto-logged. */
  audit?: {
    record(input: AuditInput): AuditEntry;
  };
}

/** Hook signature used by `onPause` (PRD 10.10 kill switch wiring). */
export type PauseHook = () => void | Promise<void>;