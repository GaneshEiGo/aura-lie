// packages/search-broker/src/ledger.ts
// PRD 8.5 + 13.6 — the quota ledger, in-process edition.
// Production uses a Durable Object with SQLite; tests use this class with
// an injectable clock. Same reservation semantics in both.

import type {
  Clock,
  PoolConfig,
  PoolId,
  PoolState,
  ReserveResult,
} from './types.js';

export class SearchLedger {
  private readonly configs: Map<PoolId, PoolConfig>;
  private readonly pools = new Map<PoolId, PoolState>();
  private readonly clock: Clock;

  constructor(configs: PoolConfig[], clock: Clock) {
    this.configs = new Map(configs.map((c) => [c.id, c]));
    this.clock = clock;
    const now = clock.now();
    for (const c of configs) {
      this.pools.set(c.id, {
        usedToday: 0,
        usedThisMonth: 0,
        totalUsed: 0,
        dayStart: startOfDay(now),
        monthStart: startOfMonth(now),
        recentRequestsAt: [],
      });
    }
  }

  now(): number {
    return this.clock.now();
  }

  tryReserve(poolId: PoolId, cost: number): ReserveResult {
    const config = this.configs.get(poolId);
    if (!config) return { ok: false, reason: 'unknown-pool' };

    const now = this.clock.now();
    const state = this.rollover(poolId, config, now);

    if (config.throttle) {
      const cutoff = now - config.throttle.windowMs;
      state.recentRequestsAt = state.recentRequestsAt.filter((t) => t > cutoff);
      if (state.recentRequestsAt.length >= config.throttle.limit) {
        return { ok: false, reason: 'throttled' };
      }
    }

    if (
      config.dailyLimit !== undefined &&
      state.usedToday + cost > config.dailyLimit
    ) {
      return { ok: false, reason: 'daily-limit' };
    }

    if (config.monthlyLimit !== undefined) {
      const day = new Date(now).getDate();
      const reserve =
        config.monthlyReserveUntilDay && day < config.monthlyReserveUntilDay
          ? config.monthlyReserveAmount ?? 0
          : 0;
      const maxUsable = config.monthlyLimit - reserve;
      if (state.usedThisMonth + cost > maxUsable) {
        return {
          ok: false,
          reason: reserve > 0 ? 'monthly-reserve' : 'monthly-limit',
        };
      }
    }

    if (
      config.totalLimit !== undefined &&
      state.totalUsed + cost > config.totalLimit
    ) {
      return { ok: false, reason: 'total-exhausted' };
    }

    state.usedToday += cost;
    state.usedThisMonth += cost;
    state.totalUsed += cost;
    if (config.throttle) state.recentRequestsAt.push(now);

    return { ok: true, reason: 'ok' };
  }

  refund(poolId: PoolId): void {
    const state = this.pools.get(poolId);
    if (!state) return;
    state.usedToday = Math.max(0, state.usedToday - 1);
    state.usedThisMonth = Math.max(0, state.usedThisMonth - 1);
    state.totalUsed = Math.max(0, state.totalUsed - 1);
  }

  getState(poolId: PoolId): PoolState {
    const config = this.configs.get(poolId);
    const state = this.pools.get(poolId);
    if (!config || !state) {
      return {
        usedToday: 0,
        usedThisMonth: 0,
        totalUsed: 0,
        dayStart: 0,
        monthStart: 0,
        recentRequestsAt: [],
      };
    }
    this.rollover(poolId, config, this.clock.now());
    return {
      ...state,
      recentRequestsAt: [...state.recentRequestsAt],
    };
  }

  private rollover(poolId: PoolId, config: PoolConfig, now: number): PoolState {
    const state = this.pools.get(poolId);
    if (!state) {
      const fresh: PoolState = {
        usedToday: 0,
        usedThisMonth: 0,
        totalUsed: 0,
        dayStart: startOfDay(now),
        monthStart: startOfMonth(now),
        recentRequestsAt: [],
      };
      this.pools.set(poolId, fresh);
      return fresh;
    }

    if (!sameDay(state.dayStart, now)) {
      state.usedToday = 0;
      state.dayStart = startOfDay(now);
    }
    if (!sameMonth(state.monthStart, now)) {
      state.usedThisMonth = 0;
      state.monthStart = startOfMonth(now);
    }

    if (config.throttle) {
      const cutoff = now - config.throttle.windowMs;
      state.recentRequestsAt = state.recentRequestsAt.filter((t) => t > cutoff);
    }

    return state;
  }
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(now: number): number {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

function sameMonth(a: number, b: number): boolean {
  return startOfMonth(a) === startOfMonth(b);
}