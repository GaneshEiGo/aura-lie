// === FILE START ===
// packages/truth-score/src/broker.ts
// PRD 8.5 · F-032 · FR-TRUTH-03 · FR-WF-03 · T-29.
//
// The Verification Quota Ledger. A separate ledger from the model quota
// ledger. Counts SEARCHES and PAGE FETCHES, one row per attempt, so the
// Truth Engine can balance caps per pool, throttle politely, fall through
// when one pool empties, and NEVER show a fabricated source.
//
// Section 77 FIX (this revision):
//   Only pools with a per-minute rate in the PRD get one.
//   · wikipedia — "5 requests per second" (PRD 4.3) = 300/min
//   · jina      — "about 20 requests per minute" (PRD 4.3) = 20/min
//   · arxiv     — "polite use" = 60/min (1/s, our engineering choice)
//   · everything else has NO per-minute cap; their daily/monthly/
//     one-time caps are the only constraint.
//
// Pools in v1 (PRD 4.3, 8.5):
//   wikipedia        keyless, 300/min (5/s), no daily cap
//   arxiv            keyless, 60/min (polite), no daily cap
//   gemini-grounding 150/day soft cap, no per-minute cap
//   tavily           25/day, 1000/month, 300-credit reserve until day 25
//   exa              25/day, 750/month
//   serper           10/day, 2,500 one-time
//   jina             20/min, no daily cap

export type PoolId =
  | 'wikipedia'
  | 'arxiv'
  | 'gemini-grounding'
  | 'tavily'
  | 'exa'
  | 'serper'
  | 'jina';

export type Purpose = 'interactive' | 'verify' | 'background';

export type DenialReason =
  | 'unknown_pool'
  | 'not_allowed_for_purpose'
  | 'daily_exhausted'
  | 'monthly_exhausted'
  | 'one_time_exhausted'
  | 'rate_limited'
  | 'blocked_429'
  | 'background_reserve';

export interface ReservationToken {
  id: string;
  pool: PoolId;
  cost: number;
  purpose: Purpose;
  requestedAt: number;
}

export type ReserveOutcome =
  | { ok: true; token: ReservationToken }
  | { ok: false; reason: DenialReason; retryAfterMs: number | null };

export interface LedgerRow {
  id: string;
  pool: PoolId;
  purpose: Purpose;
  cost: number;
  claimId?: string;
  result: 'ok' | 'denied';
  reason?: DenialReason;
  at: number;
}

export interface PoolConfig {
  id: PoolId;
  displayName: string;
  dailyCap: number | null;
  monthlyCap: number | null;
  oneTimeCap: number | null;
  perMinuteCap: number | null;
  monthlyReserve: number;
  allowedPurposes: Purpose[];
}

export interface PoolStatus {
  id: PoolId;
  displayName: string;
  usedToday: number;
  dailyCap: number | null;
  usedThisMonth: number;
  monthlyCap: number | null;
  usedEver: number;
  oneTimeCap: number | null;
  blockedUntil: number | null;
  resetsInMs: number;
  percentUsed: number;
}

export const DEFAULT_POOLS: Record<PoolId, PoolConfig> = {
  wikipedia: {
    id: 'wikipedia',
    displayName: 'Wikipedia & Wikidata',
    dailyCap: null,
    monthlyCap: null,
    oneTimeCap: null,
    // PRD 4.3: "throttle at 5 requests per second" → 300 per 60s minute
    perMinuteCap: 300,
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify', 'background'],
  },
  arxiv: {
    id: 'arxiv',
    displayName: 'arXiv & Crossref',
    dailyCap: null,
    monthlyCap: null,
    oneTimeCap: null,
    // PRD 4.3: "polite use" — engineering choice: 1/s sustained
    perMinuteCap: 60,
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify', 'background'],
  },
  'gemini-grounding': {
    id: 'gemini-grounding',
    displayName: 'Gemini grounding',
    dailyCap: 150,
    monthlyCap: null,
    oneTimeCap: null,
    perMinuteCap: null, // no per-minute stated in PRD
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify'],
  },
  tavily: {
    id: 'tavily',
    displayName: 'Tavily',
    dailyCap: 25,
    monthlyCap: 1000,
    oneTimeCap: null,
    perMinuteCap: null, // no per-minute stated in PRD
    monthlyReserve: 300,
    allowedPurposes: ['interactive', 'verify'],
  },
  exa: {
    id: 'exa',
    displayName: 'Exa',
    dailyCap: 25,
    monthlyCap: 750,
    oneTimeCap: null,
    perMinuteCap: null, // no per-minute stated in PRD
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify'],
  },
  serper: {
    id: 'serper',
    displayName: 'Serper',
    dailyCap: 10,
    monthlyCap: null,
    oneTimeCap: 2500,
    perMinuteCap: null, // no per-minute stated in PRD
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify'],
  },
  jina: {
    id: 'jina',
    displayName: 'Jina Reader',
    dailyCap: null,
    monthlyCap: null,
    oneTimeCap: null,
    // PRD 4.3: "about 20 requests per minute"
    perMinuteCap: 20,
    monthlyReserve: 0,
    allowedPurposes: ['interactive', 'verify', 'background'],
  },
};

// -----------------------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------------------

const MINUTE_MS = 60_000;

function startOfUTCDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfUTCMonth(ms: number): number {
  const d = new Date(ms);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function msUntilNextUTCMidnight(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime() - ms;
}

function msUntilNextUTCMonth(ms: number): number {
  const d = new Date(ms);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime() - ms;
}

interface PoolRuntimeState {
  usedToday: number;
  usedThisMonth: number;
  usedEver: number;
  minuteWindowStart: number;
  usedThisMinute: number;
  blockedUntil: number | null;
  lastDailyReset: number;
  lastMonthlyReset: number;
}

function freshState(now: number): PoolRuntimeState {
  return {
    usedToday: 0,
    usedThisMonth: 0,
    usedEver: 0,
    minuteWindowStart: now,
    usedThisMinute: 0,
    blockedUntil: null,
    lastDailyReset: startOfUTCDay(now),
    lastMonthlyReset: startOfUTCMonth(now),
  };
}

export interface VerificationBrokerOptions {
  config?: Partial<Record<PoolId, Partial<PoolConfig>>>;
  now?: () => number;
}

export class VerificationBroker {
  private readonly configs: Map<PoolId, PoolConfig>;
  private readonly state: Map<PoolId, PoolRuntimeState>;
  private readonly ledger: LedgerRow[];
  private readonly now: () => number;
  private tokenCounter = 0;

  constructor(opts: VerificationBrokerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.configs = new Map();
    this.state = new Map();
    this.ledger = [];

    for (const id of Object.keys(DEFAULT_POOLS) as PoolId[]) {
      const base = DEFAULT_POOLS[id];
      const override = opts.config?.[id];
      this.configs.set(id, { ...base, ...(override ?? {}) });
      this.state.set(id, freshState(this.now()));
    }
  }

  reserve(
    pool: PoolId,
    cost: number,
    purpose: Purpose,
    claimId?: string,
  ): ReserveOutcome {
    const cfg = this.configs.get(pool);
    if (!cfg) {
      return this.deny(pool, cost, purpose, claimId, 'unknown_pool', null);
    }
    if (!cfg.allowedPurposes.includes(purpose)) {
      return this.deny(pool, cost, purpose, claimId, 'not_allowed_for_purpose', null);
    }

    const st = this.state.get(pool)!;
    const now = this.now();
    this.rollClocks(cfg, st, now);

    // 429 blocks everything.
    if (st.blockedUntil !== null && now < st.blockedUntil) {
      return this.deny(pool, cost, purpose, claimId, 'blocked_429', st.blockedUntil - now);
    }

    // Background cannot starve interactive (FR-WF-03).
    if (purpose === 'background' && this.interactiveReserveFraction() < 0.30) {
      return this.deny(pool, cost, purpose, claimId, 'background_reserve', null);
    }

    // Daily cap.
    if (cfg.dailyCap !== null && st.usedToday + cost > cfg.dailyCap) {
      return this.deny(pool, cost, purpose, claimId, 'daily_exhausted', msUntilNextUTCMidnight(now));
    }

    // Monthly cap with day-25 reserve gate.
    if (cfg.monthlyCap !== null) {
      const effective = this.effectiveMonthlyCap(cfg, now);
      if (st.usedThisMonth + cost > effective) {
        return this.deny(pool, cost, purpose, claimId, 'monthly_exhausted', msUntilNextUTCMonth(now));
      }
    }

    // One-time cap.
    if (cfg.oneTimeCap !== null && st.usedEver + cost > cfg.oneTimeCap) {
      return this.deny(pool, cost, purpose, claimId, 'one_time_exhausted', null);
    }

    // Per-minute throttle (only pools with perMinuteCap !== null).
    if (cfg.perMinuteCap !== null) {
      if (now - st.minuteWindowStart >= MINUTE_MS) {
        st.minuteWindowStart = now;
        st.usedThisMinute = 0;
      }
      if (st.usedThisMinute + cost > cfg.perMinuteCap) {
        return this.deny(
          pool,
          cost,
          purpose,
          claimId,
          'rate_limited',
          MINUTE_MS - (now - st.minuteWindowStart),
        );
      }
    }

    st.usedToday += cost;
    st.usedThisMonth += cost;
    st.usedEver += cost;
    if (cfg.perMinuteCap !== null) st.usedThisMinute += cost;

    const token: ReservationToken = {
      id: `tok-${++this.tokenCounter}`,
      pool,
      cost,
      purpose,
      requestedAt: now,
    };
    this.writeLedger({
      id: token.id,
      pool,
      purpose,
      cost,
      claimId,
      result: 'ok',
      at: now,
    });
    return { ok: true, token };
  }

  commit(token: ReservationToken, actualCost: number): void {
    const cfg = this.configs.get(token.pool);
    const st = this.state.get(token.pool);
    if (!cfg || !st) return;
    const clamped = Math.max(0, Math.min(actualCost, token.cost));
    const refund = token.cost - clamped;
    if (refund === 0) return;
    st.usedToday = Math.max(0, st.usedToday - refund);
    st.usedThisMonth = Math.max(0, st.usedThisMonth - refund);
    st.usedEver = Math.max(0, st.usedEver - refund);
    if (cfg.perMinuteCap !== null) {
      st.usedThisMinute = Math.max(0, st.usedThisMinute - refund);
    }
  }

  release(token: ReservationToken): void {
    this.commit(token, 0);
  }

  record429(pool: PoolId, retryAfterMs: number): void {
    const st = this.state.get(pool);
    if (!st) return;
    const now = this.now();
    const until = now + Math.max(0, retryAfterMs);
    st.blockedUntil = st.blockedUntil === null ? until : Math.max(st.blockedUntil, until);
  }

  canReserve(pool: PoolId, cost: number, purpose: Purpose): ReserveOutcome {
    const snapshots: Array<[PoolId, PoolRuntimeState]> = [];
    for (const [id, st] of this.state.entries()) snapshots.push([id, { ...st }]);
    const ledgerLength = this.ledger.length;

    const outcome = this.reserve(pool, cost, purpose);

    for (const [id, st] of snapshots) this.state.set(id, st);
    this.ledger.length = ledgerLength;
    if (outcome.ok) this.tokenCounter -= 1;
    return outcome;
  }

  reserveWithFallback(
    preferred: PoolId[],
    purpose: Purpose,
    cost: number = 1,
    claimId?: string,
  ):
    | { ok: true; token: ReservationToken }
    | { ok: false; attempts: Array<{ pool: PoolId; reason: DenialReason }> } {
    const attempts: Array<{ pool: PoolId; reason: DenialReason }> = [];
    for (const pool of preferred) {
      const outcome = this.reserve(pool, cost, purpose, claimId);
      if (outcome.ok) return outcome;
      attempts.push({ pool, reason: outcome.reason });
    }
    return { ok: false, attempts };
  }

  getNextPool(preferred: PoolId[], purpose: Purpose, cost: number = 1): PoolId | null {
    for (const pool of preferred) {
      const check = this.canReserve(pool, cost, purpose);
      if (check.ok) return pool;
    }
    return null;
  }

  getStatus(): PoolStatus[] {
    const now = this.now();
    const out: PoolStatus[] = [];
    for (const id of Object.keys(DEFAULT_POOLS) as PoolId[]) {
      const cfg = this.configs.get(id)!;
      const st = this.state.get(id)!;
      this.rollClocks(cfg, st, now);

      let resetsInMs = 0;
      if (st.blockedUntil !== null && now < st.blockedUntil) {
        resetsInMs = st.blockedUntil - now;
      } else if (cfg.dailyCap !== null && st.usedToday >= cfg.dailyCap) {
        resetsInMs = msUntilNextUTCMidnight(now);
      } else if (cfg.monthlyCap !== null) {
        const effective = this.effectiveMonthlyCap(cfg, now);
        if (st.usedThisMonth >= effective) {
          resetsInMs = msUntilNextUTCMonth(now);
        }
      }

      out.push({
        id,
        displayName: cfg.displayName,
        usedToday: st.usedToday,
        dailyCap: cfg.dailyCap,
        usedThisMonth: st.usedThisMonth,
        monthlyCap: cfg.monthlyCap,
        usedEver: st.usedEver,
        oneTimeCap: cfg.oneTimeCap,
        blockedUntil: st.blockedUntil,
        resetsInMs,
        percentUsed: this.percentUsed(cfg, st, now),
      });
    }
    return out;
  }

  getLedger(): ReadonlyArray<LedgerRow> {
    return this.ledger;
  }

  private deny(
    pool: PoolId,
    cost: number,
    purpose: Purpose,
    claimId: string | undefined,
    reason: DenialReason,
    retryAfterMs: number | null,
  ): ReserveOutcome {
    this.writeLedger({
      id: `deny-${++this.tokenCounter}`,
      pool,
      purpose,
      cost,
      claimId,
      result: 'denied',
      reason,
      at: this.now(),
    });
    return { ok: false, reason, retryAfterMs };
  }

  private writeLedger(row: LedgerRow): void {
    this.ledger.push(row);
  }

  private rollClocks(cfg: PoolConfig, st: PoolRuntimeState, now: number): void {
    if (st.lastDailyReset < startOfUTCDay(now)) {
      st.usedToday = 0;
      st.lastDailyReset = startOfUTCDay(now);
    }
    if (st.lastMonthlyReset < startOfUTCMonth(now)) {
      st.usedThisMonth = 0;
      st.lastMonthlyReset = startOfUTCMonth(now);
    }
    if (st.blockedUntil !== null && now >= st.blockedUntil) {
      st.blockedUntil = null;
    }
    void cfg;
  }

  private effectiveMonthlyCap(cfg: PoolConfig, now: number): number {
    if (cfg.monthlyCap === null) return Infinity;
    if (cfg.monthlyReserve === 0) return cfg.monthlyCap;
    const dayOfMonth = new Date(now).getUTCDate();
    if (dayOfMonth < 25) return cfg.monthlyCap - cfg.monthlyReserve;
    return cfg.monthlyCap;
  }

  private interactiveReserveFraction(): number {
    let totalCap = 0;
    let totalRemaining = 0;
    for (const id of Object.keys(DEFAULT_POOLS) as PoolId[]) {
      const cfg = this.configs.get(id)!;
      if (!cfg.allowedPurposes.includes('interactive')) continue;
      if (cfg.dailyCap === null) continue;
      const st = this.state.get(id)!;
      totalCap += cfg.dailyCap;
      totalRemaining += Math.max(0, cfg.dailyCap - st.usedToday);
    }
    if (totalCap === 0) return 1.0;
    return totalRemaining / totalCap;
  }

  private percentUsed(cfg: PoolConfig, st: PoolRuntimeState, now: number): number {
    let max = 0;
    if (cfg.dailyCap !== null) {
      max = Math.max(max, st.usedToday / cfg.dailyCap);
    }
    if (cfg.monthlyCap !== null) {
      const eff = this.effectiveMonthlyCap(cfg, now);
      if (eff > 0) max = Math.max(max, st.usedThisMonth / eff);
    }
    if (cfg.oneTimeCap !== null) {
      max = Math.max(max, st.usedEver / cfg.oneTimeCap);
    }
    return Math.min(1, Math.max(0, max));
  }
}
// === FILE END ===