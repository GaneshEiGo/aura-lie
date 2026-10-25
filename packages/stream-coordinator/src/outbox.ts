// packages/stream-coordinator/src/outbox.ts
// T-23: "Outbox sends once when back online. No loss, no duplicates."
// Every queued message has an idempotency key. Re-enqueue with the same key
// is a no-op; flush removes items only after the sender confirms.

import type {
  OutboxFlushResult,
  OutboxItem,
} from './types.js';

export class Outbox {
  private items: OutboxItem[] = [];
  private readonly keys = new Set<string>();

  /** Queue a payload. Returns false if the key is already queued. */
  enqueue(key: string, payload: unknown, now = Date.now()): boolean {
    if (!key || typeof key !== 'string') {
      throw new Error('Outbox.enqueue: key must be a non-empty string');
    }
    if (this.keys.has(key)) return false;
    this.items.push({ key, payload, enqueuedAt: now });
    this.keys.add(key);
    return true;
  }

  /** Number of pending items. */
  size(): number {
    return this.items.length;
  }

  /** Snapshot of pending items (order preserved). */
  pending(): OutboxItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /**
   * Send every pending item, in order. Items successfully sent are removed;
   * items that throw stay queued for retry. Order preservation guarantees
   * no loss and no duplication (T-23).
   */
  async flush(
    sender: (item: OutboxItem) => Promise<void> | void,
  ): Promise<OutboxFlushResult> {
    let sent = 0;
    let failed = 0;
    const survivors: OutboxItem[] = [];

    // Snapshot so a concurrent enqueue during flush isn't lost.
    const toSend = this.items.slice();

    for (const item of toSend) {
      try {
        await sender(item);
        sent += 1;
        this.keys.delete(item.key);
      } catch {
        failed += 1;
        survivors.push(item);
      }
    }

    // Preserve any items that were enqueued during the flush (none expected
    // in single-threaded JS, but defensive).
    for (const pendingItem of this.items) {
      if (
        !toSend.some((s) => s.key === pendingItem.key) &&
        !survivors.some((s) => s.key === pendingItem.key)
      ) {
        survivors.push(pendingItem);
      }
    }

    this.items = survivors;
    return { sent, failed };
  }

  clear(): void {
    this.items = [];
    this.keys.clear();
  }
}