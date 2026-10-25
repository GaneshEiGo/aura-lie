// === FILE START ===
// packages/core-mode/src/heartbeat-bridge.ts
// PRD 10.4 · 13.7 · FR-CORE-04/06 · T-28.
//
// Drains a promise queue FIFO on each Cloudflare Cron tick.
// Queue-shape-agnostic: any object with pending / resumeOne / stats works.
// `adaptPromiseStore` lets the engine's PromiseStore work too.

export interface QueueLike {
  pending(): Array<{ id: string; query: string }>;
  resumeOne(id: string, answer: string | null): void;
  stats(): {
    total: number;
    pending: number;
    kept: number;
    broken: number;
    keepRate: number;
  };
}

export interface HeartbeatNotification {
  promiseId: string;
  query: string;
  success: boolean;
  answer?: string;
}

export interface HeartbeatBridgeOptions {
  clock?: { now(): number };
  /** Checked first on every tick. `true` means "skip everything". */
  killSwitch?: () => boolean;
  /** Return a string to keep the promise; `null` to break it. */
  resolver?: (query: string) => string | null;
  /** Fired after each promise resolves (kept OR broken). */
  notifier?: (n: HeartbeatNotification) => void;
  /** Max promises to process in one tick. Default 100. */
  maxResolvePerTick?: number;
}

export interface HeartbeatTickResult {
  ran: boolean;
  skipped: boolean;
  reason?: 'kill-switch' | 'empty-queue';
  resolved: number;
  kept: number;
  broken: number;
  pending: number;
  /** 0..1. */
  keepRate: number;
  elapsedMs: number;
  notifications: HeartbeatNotification[];
}

const DEFAULT_MAX_PER_TICK = 100;

export class HeartbeatBridge {
  private readonly clock: { now(): number };
  private readonly killSwitch: () => boolean;
  private readonly resolver: (query: string) => string | null;
  private readonly notifier: ((n: HeartbeatNotification) => void) | undefined;
  private readonly maxPerTick: number;

  constructor(
    private readonly queue: QueueLike,
    options: HeartbeatBridgeOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.killSwitch = options.killSwitch ?? (() => false);
    this.resolver = options.resolver ?? (() => null);
    this.notifier = options.notifier;
    this.maxPerTick = options.maxResolvePerTick ?? DEFAULT_MAX_PER_TICK;
  }

  tick(): HeartbeatTickResult {
    const start = this.clock.now();

    // 1 — kill switch first (PRD 10.4)
    if (this.killSwitch()) {
      const stats = this.queue.stats();
      return {
        ran: false,
        skipped: true,
        reason: 'kill-switch',
        resolved: 0,
        kept: 0,
        broken: 0,
        pending: stats.pending,
        keepRate: stats.keepRate,
        elapsedMs: this.clock.now() - start,
        notifications: [],
      };
    }

    // 2 — read pending FIFO
    const pending = this.queue.pending();
    if (pending.length === 0) {
      const stats = this.queue.stats();
      return {
        ran: true,
        skipped: true,
        reason: 'empty-queue',
        resolved: 0,
        kept: 0,
        broken: 0,
        pending: 0,
        keepRate: stats.keepRate,
        elapsedMs: this.clock.now() - start,
        notifications: [],
      };
    }

    // 3 — resolve FIFO, capped
    const notifications: HeartbeatNotification[] = [];
    let kept = 0;
    let broken = 0;
    let processed = 0;

    for (const p of pending) {
      if (processed >= this.maxPerTick) break;
      processed += 1;

      const answer = this.resolver(p.query);
      const success = answer !== null;
      this.queue.resumeOne(p.id, success ? answer : null);

      if (success) kept += 1;
      else broken += 1;

      const notif: HeartbeatNotification = {
        promiseId: p.id,
        query: p.query,
        success,
        answer: answer ?? undefined,
      };
      notifications.push(notif);
      if (this.notifier) this.notifier(notif);
    }

    const stats = this.queue.stats();
    return {
      ran: true,
      skipped: false,
      resolved: kept + broken,
      kept,
      broken,
      pending: stats.pending,
      keepRate: stats.keepRate,
      elapsedMs: this.clock.now() - start,
      notifications,
    };
  }
}

/** Adapter so the bridge drives the engine's PromiseStore unchanged. */
export interface PromiseStoreLike {
  getPending(): Array<{ id: string; query: string }>;
  resume(id: string, success: boolean): void;
  size(): number;
  /** 0..100. */
  getKeepRate(): number;
}

export function adaptPromiseStore(store: PromiseStoreLike): QueueLike {
  return {
    pending: () => store.getPending().map((p) => ({ id: p.id, query: p.query })),
    resumeOne: (id, answer) => {
      store.resume(id, answer !== null);
    },
    stats: () => {
      const total = store.size();
      const pending = store.getPending().length;
      const resolved = total - pending;
      const keepRate = store.getKeepRate() / 100;
      const kept = resolved > 0 ? Math.round(resolved * keepRate) : 0;
      return {
        total,
        pending,
        kept,
        broken: resolved - kept,
        keepRate,
      };
    },
  };
}
// === FILE END ===