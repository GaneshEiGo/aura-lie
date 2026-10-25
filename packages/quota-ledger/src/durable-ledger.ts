// === FILE START ===
// packages/quota-ledger/src/durable-ledger.ts
// PRD 13.6 · FR-WF-03 · T-21.
//
// The QuotaLedger Durable Object. A single-threaded counter per pool that
// refuses before the provider does. Every reserve is atomic. The async API
// adds a per-pool serialization queue so that concurrent `reserveAsync` calls
// never interleave between the check and the write.
//
// PRD 13.6 algorithm:
//   reserve(pool, est, purpose):
//     if pool.blocked_until > now: DENY(next_reset)
//     if purpose == 'background' AND interactive_reserve_pct < 30%: DENY
//     if pool.used + est > pool.planning_limit: DENY
//     pool.used += est; return TOKEN
//   commit(token, actual): pool.used += (actual - est)
//   on_provider_429: pool.blocked_until = now + backoff
//   daily rollover: per-provider reset time (Cloudflare 00:00 UTC)
//
// Planning limits start at 80% of the seed values from PRD 4.1.
//
// T-21 CONCURRENCY GUARANTEE:
//   The `reserve` method is atomic by definition (sync JS is single-threaded).
//   The `reserveAsync` method wraps `reserve` in a per-pool Promise chain so
//   that even an arbitrary number of concurrent calls yield exactly one
//   sequential execution per pool.
//   The `_reserveYieldingForTest` method deliberately yields between the
//   check and the write, exposing the classic TOCTOU race when called
//   without the queue — this proves that the queue is what prevents overspend.

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type Purpose = 'interactive' | 'verify' | 'background';

export interface LedgerPoolConfig {
  id: string;
  /** Planned daily ceiling. 0 = auto-derive from dailySeed × 80%. */
  planningLimit?: number;
  /** Seed value from PRD 4.1 (used for default planning limit). */
  dailySeed: number;
  /** 1 = pool is fully interactive, 0 = background-only. */
  interactiveReservePct: number;
}

export interface ReserveToken {
  poolId: string;
  est: number;
  issuedAt: number;
  purpose: Purpose;
}

export type QuotaDenialReason =
  | 'blocked'
  | 'background_reserve'
  | 'exhausted'
  | 'unknown_pool';

export interface QuotaDenial {
  ok: false;
  reason: QuotaDenialReason;
  nextResetAt: number | null;
}

export interface QuotaReserveSuccess {
  ok: true;
  token: ReserveToken;
}

export type QuotaReserveOutcome = QuotaReserveSuccess | QuotaDenial;

export interface PoolStateSnapshot {
  poolId: string;
  used: number;
  planningLimit: number;
  blockedUntil: number | null;
  lastReset: number;
  limitSeen: number | null;
}

export interface DurableLedgerOptions {
  pools: LedgerPoolConfig[];
  now?: () => number;
}

// -----------------------------------------------------------------------------
// Constants (PRD 13.6)
// -----------------------------------------------------------------------------

const DEFAULT_PLANNING_FRACTION = 0.8;
const BACKGROUND_MIN_INTERACTIVE = 0.3;

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function utcNextMidnight(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

interface InternalState {
  used: number;
  blockedUntil: number | null;
  lastReset: number;
  limitSeen: number | null;
}

// -----------------------------------------------------------------------------
// DurableLedger
// -----------------------------------------------------------------------------

export class DurableLedger {
  private readonly configs = new Map<string, Required<LedgerPoolConfig>>();
  private readonly state = new Map<string, InternalState>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(opts: DurableLedgerOptions) {
    this.now = opts.now ?? (() => Date.now());
    for (const cfg of opts.pools) {
      const planningLimit =
        cfg.planningLimit && cfg.planningLimit > 0
          ? cfg.planningLimit
          : Math.max(1, Math.floor(cfg.dailySeed * DEFAULT_PLANNING_FRACTION));
      this.configs.set(cfg.id, { ...cfg, planningLimit });
      this.state.set(cfg.id, {
        used: 0,
        blockedUntil: null,
        lastReset: utcDayStart(this.now()),
        limitSeen: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Synchronous API — the Durable Object core
  // ---------------------------------------------------------------------------

  reserve(poolId: string, est: number, purpose: Purpose): QuotaReserveOutcome {
    const cfg = this.configs.get(poolId);
    const st = this.state.get(poolId);
    if (!cfg || !st) {
      return { ok: false, reason: 'unknown_pool', nextResetAt: null };
    }
    this.rollIfNewDay(poolId);
    const t = this.now();

    if (st.blockedUntil !== null && t < st.blockedUntil) {
      return { ok: false, reason: 'blocked', nextResetAt: st.blockedUntil };
    }

    if (purpose === 'background') {
      const frac = this.interactiveReserveFraction();
      if (frac < BACKGROUND_MIN_INTERACTIVE) {
        return {
          ok: false,
          reason: 'background_reserve',
          nextResetAt: utcNextMidnight(t),
        };
      }
    }

    if (st.used + est > cfg.planningLimit) {
      return {
        ok: false,
        reason: 'exhausted',
        nextResetAt: utcNextMidnight(t),
      };
    }

    st.used += est;
    return {
      ok: true,
      token: { poolId, est, issuedAt: t, purpose },
    };
  }

  commit(token: ReserveToken, actual: number): void {
    const st = this.state.get(token.poolId);
    if (!st) return;
    const clamped = Math.max(0, Math.min(actual, token.est));
    const refund = token.est - clamped;
    if (refund === 0) return;
    st.used = Math.max(0, st.used - refund);
  }

  release(token: ReserveToken): void {
    this.commit(token, 0);
  }

  onProvider429(poolId: string, retryAfterMs: number): void {
    const st = this.state.get(poolId);
    if (!st) return;
    const t = this.now();
    const until = t + Math.max(0, retryAfterMs);
    st.blockedUntil = st.blockedUntil === null ? until : Math.max(st.blockedUntil, until);
  }

  observeLimit(poolId: string, observed: number): void {
    const st = this.state.get(poolId);
    if (!st) return;
    st.limitSeen = observed;
  }

  getState(poolId: string): PoolStateSnapshot | null {
    const cfg = this.configs.get(poolId);
    const st = this.state.get(poolId);
    if (!cfg || !st) return null;
    this.rollIfNewDay(poolId);
    return {
      poolId,
      used: st.used,
      planningLimit: cfg.planningLimit,
      blockedUntil: st.blockedUntil,
      lastReset: st.lastReset,
      limitSeen: st.limitSeen,
    };
  }

  getAllStates(): PoolStateSnapshot[] {
    const out: PoolStateSnapshot[] = [];
    for (const id of this.configs.keys()) {
      const s = this.getState(id);
      if (s) out.push(s);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Async API — serialized through the per-pool queue
  // ---------------------------------------------------------------------------

  async reserveAsync(
    poolId: string,
    est: number,
    purpose: Purpose,
  ): Promise<QuotaReserveOutcome> {
    return this.enqueueOnPool(poolId, () => this.reserve(poolId, est, purpose));
  }

  async commitAsync(token: ReserveToken, actual: number): Promise<void> {
    return this.enqueueOnPool(token.poolId, () => this.commit(token, actual));
  }

  async releaseAsync(token: ReserveToken): Promise<void> {
    return this.enqueueOnPool(token.poolId, () => this.release(token));
  }

  // ---------------------------------------------------------------------------
  // TEST-ONLY: a deliberately yielding reserve
  // ---------------------------------------------------------------------------

  /**
   * DO NOT USE IN PRODUCTION. Deliberately yields between the check and the
   * write to expose the TOCTOU race when the queue is bypassed.
   *
   * - Called directly N times concurrently: overspends (proves the bug).
   * - Called via `reserveAsyncWithYield` (queue-serialized): exactly the
   *   planning limit succeed (proves the queue fixes it).
   */
  async _reserveYieldingForTest(
    poolId: string,
    est: number,
    purpose: Purpose = 'interactive',
  ): Promise<QuotaReserveOutcome> {
    const cfg = this.configs.get(poolId);
    const st = this.state.get(poolId);
    if (!cfg || !st) {
      return { ok: false, reason: 'unknown_pool', nextResetAt: null };
    }
    this.rollIfNewDay(poolId);
    const t = this.now();

    if (st.blockedUntil !== null && t < st.blockedUntil) {
      return { ok: false, reason: 'blocked', nextResetAt: st.blockedUntil };
    }

    // Deliberate race hazard: compute check from current state, then yield.
    const wouldExceed = st.used + est > cfg.planningLimit;

    // Simulates a real Durable Object RPC or network await inside reserve().
    await Promise.resolve();

    if (wouldExceed) {
      return {
        ok: false,
        reason: 'exhausted',
        nextResetAt: utcNextMidnight(t),
      };
    }

    st.used += est;
    return {
      ok: true,
      token: { poolId, est, issuedAt: t, purpose },
    };
  }

  /**
   * TEST-ONLY: wraps the yielding reserve in the same per-pool queue that
   * `reserveAsync` uses. Proves the queue prevents overspend even when the
   * underlying reserve yields.
   */
  async reserveAsyncWithYield(
    poolId: string,
    est: number,
    purpose: Purpose = 'interactive',
  ): Promise<QuotaReserveOutcome> {
    return this.enqueueOnPool(poolId, () =>
      this._reserveYieldingForTest(poolId, est, purpose),
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private rollIfNewDay(poolId: string): void {
    const st = this.state.get(poolId);
    if (!st) return;
    const t = this.now();
    const today = utcDayStart(t);
    if (today > st.lastReset) {
      st.used = 0;
      st.lastReset = today;
      if (st.blockedUntil !== null && t >= st.blockedUntil) {
        st.blockedUntil = null;
      }
    }
  }

  private interactiveReserveFraction(): number {
    let total = 0;
    let remaining = 0;
    for (const [id, cfg] of this.configs.entries()) {
      if (cfg.interactiveReservePct <= 0) continue;
      const st = this.state.get(id)!;
      total += cfg.planningLimit;
      remaining += Math.max(0, cfg.planningLimit - st.used);
    }
    if (total === 0) return 1.0;
    return remaining / total;
  }

  private enqueueOnPool<T>(poolId: string, fn: () => T): Promise<T> {
    const prev = this.queues.get(poolId) ?? Promise.resolve();
    const result = prev.then(() => fn());
    // Swallow errors in the queue so the next waiter still runs.
    this.queues.set(
      poolId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
// === FILE END ===