// === FILE START ===
// apps/edge/src/cron/heartbeat.ts
// PRD 10.4 · Section 69.
// Standalone module. No imports from @aura-lie/*, so adding it cannot
// break the rest of the edge app.

export interface CronQueueLike {
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

export interface CronHeartbeatNotification {
  promiseId: string;
  query: string;
  success: boolean;
  answer?: string;
}

export interface CronHeartbeatOptions {
  clock?: { now(): number };
  killSwitch?: () => boolean;
  resolver?: (query: string) => string | null;
  notifier?: (n: CronHeartbeatNotification) => void;
  maxResolvePerTick?: number;
}

export interface CronHeartbeatResult {
  ran: boolean;
  skipped: boolean;
  reason?: 'kill-switch' | 'empty-queue';
  resolved: number;
  kept: number;
  broken: number;
  pending: number;
  keepRate: number;
  elapsedMs: number;
  notifications: CronHeartbeatNotification[];
}

const DEFAULT_MAX_PER_TICK = 100;

export function runHeartbeat(
  queue: CronQueueLike,
  options: CronHeartbeatOptions = {},
): CronHeartbeatResult {
  const clock = options.clock ?? { now: () => Date.now() };
  const killSwitch = options.killSwitch ?? (() => false);
  const resolver = options.resolver ?? (() => null);
  const notifier = options.notifier;
  const maxPerTick = options.maxResolvePerTick ?? DEFAULT_MAX_PER_TICK;

  const start = clock.now();

  // 1 — kill switch FIRST
  if (killSwitch()) {
    const stats = queue.stats();
    return {
      ran: false,
      skipped: true,
      reason: 'kill-switch',
      resolved: 0,
      kept: 0,
      broken: 0,
      pending: stats.pending,
      keepRate: stats.keepRate,
      elapsedMs: clock.now() - start,
      notifications: [],
    };
  }

  // 2 — read pending FIFO
  const pending = queue.pending();
  if (pending.length === 0) {
    const stats = queue.stats();
    return {
      ran: true,
      skipped: true,
      reason: 'empty-queue',
      resolved: 0,
      kept: 0,
      broken: 0,
      pending: 0,
      keepRate: stats.keepRate,
      elapsedMs: clock.now() - start,
      notifications: [],
    };
  }

  // 3 — resolve FIFO, capped
  const notifications: CronHeartbeatNotification[] = [];
  let kept = 0;
  let broken = 0;
  let processed = 0;

  for (const p of pending) {
    if (processed >= maxPerTick) break;
    processed += 1;

    const answer = resolver(p.query);
    const success = answer !== null;
    queue.resumeOne(p.id, success ? answer : null);

    if (success) kept += 1;
    else broken += 1;

    const notif: CronHeartbeatNotification = {
      promiseId: p.id,
      query: p.query,
      success,
      answer: answer ?? undefined,
    };
    notifications.push(notif);
    if (notifier) notifier(notif);
  }

  const stats = queue.stats();
  return {
    ran: true,
    skipped: false,
    resolved: kept + broken,
    kept,
    broken,
    pending: stats.pending,
    keepRate: stats.keepRate,
    elapsedMs: clock.now() - start,
    notifications,
  };
}
// === FILE END ===