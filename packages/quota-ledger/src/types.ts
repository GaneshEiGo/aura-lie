// packages/quota-ledger/src/types.ts
// PRD 13.6, FR-WF-03, Appendix C PoolSnapshot.

/**
 * PRD 7.8 FR-WF-03: "Quota is budgeted by purpose: interactive, verify and
 * background pools so background work never starves chat."
 */
export type Purpose = 'interactive' | 'verify' | 'background';

/** Internal state, keyed per pool. Not exposed to the client. */
export interface PoolState {
  used: number;
  planningLimit: number;
  blockedUntil: number | null;
  currentDayStart: number;
  lastObserved?: number;
}

/**
 * PRD 4.1 / 4.2 seed values with plan-safe margins.
 *  - `seedLimit` is the published ceiling on the dated day of research.
 *  - `resetHourUtc` is the hour of day at which the provider resets usage
 *    (Cloudflare is 00:00 UTC per PRD 4.2).
 *  - `interactiveReservePct` is the fraction of planningLimit that must
 *    remain before background calls are refused (default 0.30 per FR-WF-03).
 */
export interface PoolConfig {
  id: string;
  seedLimit: number;
  resetHourUtc?: number;
  interactiveReservePct?: number;
}

/** PRD Appendix C PoolSnapshot — exactly this shape. */
export interface PoolSnapshot {
  pool: string;
  used: number;
  planningLimit: number;
  blockedUntil?: string;
  resetsAt?: string;
}

export type ReserveReason =
  | 'blocked'
  | 'daily-limit'
  | 'interactive-reserve'
  | 'unknown-pool';

/** A reservation token returned by `reserve()`. */
export interface Reservation {
  id: string;
  pool: string;
  est: number;
  purpose: Purpose;
  at: number;
}

export type ReserveResult =
  | { ok: true; token: Reservation }
  | { ok: false; reason: ReserveReason; nextResetAt?: string };

export interface On429Options {
  /** Absolute epoch ms when the pool becomes usable again. */
  resetAt?: number;
  /** Observed daily/token limit from the 429 body — relaxes planningLimit. */
  observedLimit?: number;
  /** Override the default 60-second backoff. */
  backoffMs?: number;
}

export interface LedgerClock {
  now(): number;
}