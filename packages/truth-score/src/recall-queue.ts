// === FILE START ===
// packages/truth-score/src/recall-queue.ts
// PRD 8.5 · "Verify later" · 100% promise-keep.
//
// When verifyClaim() defers a claim because search quota ran out, the claim
// goes into the RecallQueue. A scheduled drain (Cloudflare Cron, W4) picks
// up the items whose retryAt has passed and re-runs verifyClaim.
//
// Invariants:
//   · Insertion order is preserved for items with equal retryAt.
//   · Items with retryAt === Infinity (all_pools_dry — no known reset) never
//     auto-drain; they require a manual "Verify now" from the user.
//   · The queue is in-memory only. Persistence to IndexedDB is the caller's
//     responsibility (Section 78 leaves storage to the app layer).

import type { ClaimInput, FetchedSource } from './pipeline.js';

export type DeferReason = 'quota' | 'all_pools_dry';

export interface DeferredItem {
  claimId: string;
  claim: ClaimInput;
  sources: FetchedSource[];
  /** Priority hint. Central claims = 1.0, supporting = 0.5. */
  importance: number;
  /** When the item was enqueued (ms since epoch). */
  queuedAt: number;
  /**
   * When to retry (ms since epoch). Use Infinity for all_pools_dry items
   * that have no known reset time.
   */
  retryAt: number;
  reason: DeferReason;
}

export class RecallQueue {
  private items: DeferredItem[] = [];

  enqueue(item: DeferredItem): void {
    // Validate the item has a sane retryAt.
    if (item.retryAt < 0) {
      throw new Error(`RecallQueue.enqueue: retryAt must be >= 0 (got ${item.retryAt})`);
    }
    this.items.push(item);
  }

  /**
   * Remove and return all items whose retryAt <= now, in insertion order.
   * Items with retryAt === Infinity are never drained automatically.
   */
  drain(now: number): DeferredItem[] {
    const ready: DeferredItem[] = [];
    const keep: DeferredItem[] = [];
    for (const item of this.items) {
      if (item.retryAt !== Infinity && item.retryAt <= now) {
        ready.push(item);
      } else {
        keep.push(item);
      }
    }
    this.items = keep;
    return ready;
  }

  /**
   * Remove and return a specific item by claimId. Useful for manual
   * "Verify now" clicks.
   */
  takeByClaimId(claimId: string): DeferredItem | null {
    const idx = this.items.findIndex((i) => i.claimId === claimId);
    if (idx === -1) return null;
    const [item] = this.items.splice(idx, 1);
    return item;
  }

  /** Peek at the oldest item without removing it. */
  peek(): DeferredItem | null {
    return this.items.length > 0 ? this.items[0] : null;
  }

  size(): number {
    return this.items.length;
  }

  /** Read-only view of all items (for the Inbox panel). */
  all(): ReadonlyArray<DeferredItem> {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
// === FILE END ===