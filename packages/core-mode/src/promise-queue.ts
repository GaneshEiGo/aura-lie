// === FILE START ===
// packages/core-mode/src/promise-queue.ts
// PRD 7.8 · FR-CORE-04 · the visible promise queue.
// Section 69 adds `resumeOne(id, answer)` for the heartbeat bridge; every
// existing method is byte-for-byte behaviour-compatible with Section 68.

export interface QueuedPromise<T = unknown> {
  id: string;
  query: string;
  queuedAt: number;
  reason: string;
  earliestResume: number;
  status: 'pending' | 'kept' | 'broken';
  result?: T;
  resolvedAt?: number;
}

export interface PromiseQueueOptions {
  clock?: { now(): number };
  /** Default time-to-resume for the visible message, 3 h per PRD 7.8. */
  defaultResumeMs?: number;
  idGenerator?: () => string;
}

const DEFAULT_RESUME_MS = 3 * 60 * 60 * 1000;

let defaultCounter = 0;
function defaultId(): string {
  defaultCounter += 1;
  return `p_${Date.now().toString(36)}_${defaultCounter.toString(36)}`;
}

export class PromiseQueue<T = unknown> {
  private readonly promises = new Map<string, QueuedPromise<T>>();
  private readonly clock: { now(): number };
  private readonly defaultResumeMs: number;
  private readonly idGenerator: () => string;

  constructor(options: PromiseQueueOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.defaultResumeMs = options.defaultResumeMs ?? DEFAULT_RESUME_MS;
    this.idGenerator = options.idGenerator ?? defaultId;
  }

  /** Enqueue a user request with a visible promise. */
  enqueue(
    query: string,
    options: { reason: string; earliestResume?: number },
  ): QueuedPromise<T> {
    const now = this.clock.now();
    const entry: QueuedPromise<T> = {
      id: this.idGenerator(),
      query,
      queuedAt: now,
      reason: options.reason,
      earliestResume: options.earliestResume ?? now + this.defaultResumeMs,
      status: 'pending',
    };
    this.promises.set(entry.id, entry);
    return { ...entry };
  }

  /** Pending promises, FIFO order (oldest first). */
  pending(): QueuedPromise<T>[] {
    return Array.from(this.promises.values())
      .filter((p) => p.status === 'pending')
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .map((p) => ({ ...p }));
  }

  /** All promises in FIFO order. */
  all(): QueuedPromise<T>[] {
    return Array.from(this.promises.values())
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .map((p) => ({ ...p }));
  }

  get(id: string): QueuedPromise<T> | undefined {
    const p = this.promises.get(id);
    return p ? { ...p } : undefined;
  }

  /** Kept promises as a fraction of *resolved* promises. Vacuous 100% otherwise. */
  keepRate(): number {
    const all = Array.from(this.promises.values());
    const resolved = all.filter((p) => p.status !== 'pending');
    if (resolved.length === 0) return 1;
    const kept = resolved.filter((p) => p.status === 'kept').length;
    return kept / resolved.length;
  }

  /** Statistical view of the queue — used by the T-28 gate. */
  stats(): {
    total: number;
    pending: number;
    kept: number;
    broken: number;
    keepRate: number;
  } {
    const all = Array.from(this.promises.values());
    const pending = all.filter((p) => p.status === 'pending').length;
    const kept = all.filter((p) => p.status === 'kept').length;
    const broken = all.filter((p) => p.status === 'broken').length;
    return {
      total: all.length,
      pending,
      kept,
      broken,
      keepRate: this.keepRate(),
    };
  }

  /**
   * Resume every pending promise in FIFO order. `handler` is the capability
   * that finally becomes available (e.g. a real model call). If `handler`
   * returns `null`, the promise is marked broken (used to prove the metric
   * actually catches broken promises).
   */
  resumeAll(handler: (query: string) => T | null): {
    kept: number;
    broken: number;
  } {
    const pending = this.pending();
    let kept = 0;
    let broken = 0;
    const now = this.clock.now();
    for (const p of pending) {
      const entry = this.promises.get(p.id);
      if (!entry) continue;
      const result = handler(p.query);
      if (result === null) {
        entry.status = 'broken';
        entry.resolvedAt = now;
        broken += 1;
      } else {
        entry.status = 'kept';
        entry.result = result;
        entry.resolvedAt = now;
        kept += 1;
      }
    }
    return { kept, broken };
  }

  /**
   * Resolve exactly one promise by id. Section 69 addition for the
   * heartbeat bridge, which needs per-promise control to honour the
   * per-tick cap and fire per-promise notifications. Does not change
   * `resumeAll` behaviour.
   */
  resumeOne(id: string, answer: T | null): void {
    const entry = this.promises.get(id);
    if (!entry || entry.status !== 'pending') return;
    const now = this.clock.now();
    if (answer === null) {
      entry.status = 'broken';
      entry.resolvedAt = now;
    } else {
      entry.status = 'kept';
      entry.result = answer;
      entry.resolvedAt = now;
    }
  }

  /**
   * PRD 7.8 / FR-CORE-04 exact copy:
   * "Queued. I'll answer when the models reset (about 3 h) and tell you."
   */
  formatPromiseMessage(promise: QueuedPromise<T>, now?: number): string {
    const t = now ?? this.clock.now();
    const remainingMs = Math.max(0, promise.earliestResume - t);
    const minutes = Math.round(remainingMs / 60_000);
    if (minutes < 60) {
      const m = Math.max(1, minutes);
      return `Queued. I'll answer when the models reset (about ${m} min) and tell you.`;
    }
    const hours = Math.round(minutes / 60);
    return `Queued. I'll answer when the models reset (about ${hours} h) and tell you.`;
  }

  clear(): void {
    this.promises.clear();
  }

  size(): number {
    return this.promises.size;
  }
}
// === FILE END ===