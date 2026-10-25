// packages/quota-ledger/src/ledger.ts
// PRD 13.6 Quota ledger algorithm.
//
// In production this runs inside a Durable Object (SQLite-backed). The class
// below is the pure business logic; `apps/edge` wires it to the DO interface
// 1-to-1 (reserve / commit / snapshot / rollover / on429).
//
// Atomicity: `reserve` and `commit` are synchronous, so concurrent callers in
// a single-threaded Worker runtime observe them as atomic. This is the T-21
// guarantee: 1,000 parallel reservations cannot overspend.

import {
  DEFAULT_429_BACKOFF_MS,
  DEFAULT_INTERACTIVE_RESERVE_PCT,
  PLANNING_LIMIT_FRACTION,
} from './config.js';
import type {
  LedgerClock,
  On429Options,
  PoolConfig,
  PoolSnapshot,
  PoolState,
  Purpose,
  Reservation,
  ReserveResult,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class QuotaLedger {
  private readonly configs = new Map<string, PoolConfig>();
  private readonly states = new Map<string, PoolState>();
  private readonly tokens = new Map<string, Reservation>();
  private readonly clock: LedgerClock;

  constructor(configs: PoolConfig[], clock?: LedgerClock) {
    this.clock = clock ?? { now: () => Date.now() };
    for (const config of configs) {
      const dayStart = this.startOfUtcDay(
        this.clock.now(),
        config.resetHourUtc ?? 0,
      );
      this.configs.set(config.id, config);
      this.states.set(config.id, {
        used: 0,
        planningLimit: Math.floor(config.seedLimit * PLANNING_LIMIT_FRACTION),
        blockedUntil: null,
        currentDayStart: dayStart,
      });
    }
  }

  // -------------------------------------------------------------------------
  // PRD 13.6: reserve(pool, est, purpose)
  // -------------------------------------------------------------------------
  reserve(poolId: string, est: number, purpose: Purpose): ReserveResult {
    if (!Number.isFinite(est) || est < 0) {
      throw new Error(`reserve: est must be a non-negative finite number (got ${est})`);
    }

    const config = this.configs.get(poolId);
    const state = this.states.get(poolId);
    if (!config || !state) {
      return { ok: false, reason: 'unknown-pool' };
    }

    const now = this.clock.now();
    this.rolloverIfNeeded(poolId, now);

    // 1. Blocked by an observed 429 that hasn't cleared yet.
    if (state.blockedUntil !== null && now < state.blockedUntil) {
      return {
        ok: false,
        reason: 'blocked',
        nextResetAt: new Date(state.blockedUntil).toISOString(),
      };
    }
    if (state.blockedUntil !== null && now >= state.blockedUntil) {
      state.blockedUntil = null;
    }

    // 2. Planning limit — the hard headroom.
    if (state.used + est > state.planningLimit) {
      return { ok: false, reason: 'daily-limit' };
    }

    // 3. FR-WF-03: background work is refused when the interactive reserve
    //    would fall below the pool's configured threshold.
    if (purpose === 'background') {
      const threshold = config.interactiveReservePct ?? DEFAULT_INTERACTIVE_RESERVE_PCT;
      const remaining = state.planningLimit - state.used;
      const remainingPct = state.planningLimit > 0
        ? remaining / state.planningLimit
        : 0;
      if (remainingPct < threshold) {
        return { ok: false, reason: 'interactive-reserve' };
      }
    }

    // 4. Accept: bump used, mint a reservation token.
    state.used += est;
    const token: Reservation = {
      id: this.mintTokenId(poolId, now),
      pool: poolId,
      est,
      purpose,
      at: now,
    };
    this.tokens.set(token.id, token);
    return { ok: true, token };
  }

  // -------------------------------------------------------------------------
  // PRD 13.6: commit(token, actual) — settles the difference.
  // -------------------------------------------------------------------------
  commit(tokenId: string, actual: number): void {
    if (!Number.isFinite(actual) || actual < 0) {
      throw new Error(`commit: actual must be a non-negative finite number (got ${actual})`);
    }
    const token = this.tokens.get(tokenId);
    if (!token) return; // idempotent: unknown / already-committed
    const state = this.states.get(token.pool);
    if (!state) {
      this.tokens.delete(tokenId);
      return;
    }

    const delta = actual - token.est;
    state.used = Math.max(0, state.used + delta);
    this.tokens.delete(tokenId);
  }

  // -------------------------------------------------------------------------
  // PRD 13.6: on provider 429:
  //   pool.blocked_until = parsed_reset or now + backoff
  //   pool.limit_seen    = observed
  // -------------------------------------------------------------------------
  on429(poolId: string, options: On429Options = {}): void {
    const config = this.configs.get(poolId);
    const state = this.states.get(poolId);
    if (!config || !state) return;

    const now = this.clock.now();
    const backoff = options.backoffMs ?? DEFAULT_429_BACKOFF_MS;
    state.blockedUntil = options.resetAt ?? now + backoff;

    if (options.observedLimit !== undefined) {
      this.learnLimit(poolId, options.observedLimit);
    }
  }

  // -------------------------------------------------------------------------
  // PRD 13.6: "Planning limits … relax if observed headers show more."
  // We never go below the current planning limit (safety margin) and never
  // above the seed limit (obey the published ceiling).
  // -------------------------------------------------------------------------
  learnLimit(poolId: string, observedLimit: number): void {
    const config = this.configs.get(poolId);
    const state = this.states.get(poolId);
    if (!config || !state) return;
    if (!Number.isFinite(observedLimit) || observedLimit <= 0) return;

    state.lastObserved = observedLimit;
    state.planningLimit = Math.min(
      config.seedLimit,
      Math.max(state.planningLimit, observedLimit),
    );
  }

  // -------------------------------------------------------------------------
  // Snapshot in PRD Appendix C shape (ISO-8601 strings for times).
  // -------------------------------------------------------------------------
  snapshot(poolId: string): PoolSnapshot | null {
    const config = this.configs.get(poolId);
    const state = this.states.get(poolId);
    if (!config || !state) return null;

    const now = this.clock.now();
    this.rolloverIfNeeded(poolId, now);

    const nextReset = this.nextResetAt(config, now);
    const snap: PoolSnapshot = {
      pool: poolId,
      used: state.used,
      planningLimit: state.planningLimit,
      resetsAt: new Date(nextReset).toISOString(),
    };
    if (state.blockedUntil !== null) {
      snap.blockedUntil = new Date(state.blockedUntil).toISOString();
    }
    return snap;
  }

  snapshotAll(): PoolSnapshot[] {
    const out: PoolSnapshot[] = [];
    for (const id of this.states.keys()) {
      const snap = this.snapshot(id);
      if (snap) out.push(snap);
    }
    return out;
  }

  /** Test-visible count of outstanding reservations. */
  pendingTokens(): number {
    return this.tokens.size;
  }

  // -------------------------------------------------------------------------
  // Daily rollover per provider reset time.
  // -------------------------------------------------------------------------
  private rolloverIfNeeded(poolId: string, now: number): void {
    const config = this.configs.get(poolId);
    const state = this.states.get(poolId);
    if (!config || !state) return;
    const dayStart = this.startOfUtcDay(now, config.resetHourUtc ?? 0);
    if (state.currentDayStart !== dayStart) {
      state.used = 0;
      state.blockedUntil = null;
      state.currentDayStart = dayStart;
    }
  }

  /** Beginning of the current usage window (epoch ms). */
  private startOfUtcDay(now: number, resetHourUtc: number): number {
    const d = new Date(now);
    d.setUTCHours(resetHourUtc, 0, 0, 0);
    if (d.getTime() > now) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return d.getTime();
  }

  /** End of the current usage window (epoch ms). */
  private nextResetAt(config: PoolConfig, now: number): number {
    return this.startOfUtcDay(now, config.resetHourUtc ?? 0) + DAY_MS;
  }

  private mintTokenId(poolId: string, now: number): string {
    const rnd = Math.random().toString(36).slice(2, 10);
    return `tok-${poolId}-${now}-${rnd}`;
  }
}