// packages/search-broker/src/queue.ts
// PRD 8.5 "Verify later" queue. Deduplicates by claimId so re-enqueue
// on a failed retry does not spawn ghosts.

import type { QueuedClaim } from './types.js';

export class VerifyLaterQueue {
  private items: QueuedClaim[] = [];
  private readonly ids = new Set<string>();

  enqueue(item: QueuedClaim): boolean {
    if (this.ids.has(item.claimId)) return false;
    this.items.push(item);
    this.ids.add(item.claimId);
    return true;
  }

  take(limit: number): QueuedClaim[] {
    const batch = this.items.splice(0, Math.max(0, limit));
    for (const item of batch) this.ids.delete(item.claimId);
    return batch;
  }

  size(): number {
    return this.items.length;
  }

  has(claimId: string): boolean {
    return this.ids.has(claimId);
  }

  clear(): void {
    this.items = [];
    this.ids.clear();
  }
}