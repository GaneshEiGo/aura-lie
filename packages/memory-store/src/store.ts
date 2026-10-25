// packages/memory-store/src/store.ts
// PRD 9.3 lifecycle · 9.6 retrieval · 9.8 context card.
// Every public method is exercised by the test suite.

import type {
  ContextCard,
  ForgetResult,
  ListFilter,
  Memory,
  MemoryStoreOptions,
  PruneResult,
  RetrievalHit,
  RetrievalLog,
  ReviewDecision,
  SearchOptions,
} from './types.js';
import { BM25Index } from './bm25.js';
import { quantizeInt8, cosineFloat, dequantizeInt8 } from './vector.js';

const DAY_MS = 86_400_000;

export class MemoryStore {
  private readonly memories = new Map<string, Memory>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly bm25 = new BM25Index();
  private readonly int8Cache = new Map<string, Int8Array>();
  private readonly retrievalLog: RetrievalLog[] = [];
  private readonly clock: { now(): number };

  constructor(options: MemoryStoreOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
  }

  // ---------------------------------------------------------------------------
  // CRUD (PRD 9.3)
  // ---------------------------------------------------------------------------

  add(memory: Memory): Memory {
    const stored: Memory = { ...memory };
    this.memories.set(stored.id, stored);
    let ids = this.byUser.get(stored.userId);
    if (!ids) {
      ids = new Set();
      this.byUser.set(stored.userId, ids);
    }
    ids.add(stored.id);
    this.bm25.add(stored.id, stored.text);
    if (stored.embedding) {
      this.int8Cache.set(stored.id, quantizeInt8(stored.embedding.values));
    }
    return { ...stored };
  }

  get(id: string): Memory | undefined {
    const m = this.memories.get(id);
    return m ? { ...m } : undefined;
  }

  list(filter: ListFilter): Memory[] {
    const ids = this.byUser.get(filter.userId);
    if (!ids) return [];
    const out: Memory[] = [];
    for (const id of ids) {
      const m = this.memories.get(id);
      if (!m) continue;
      if (filter.type && m.type !== filter.type) continue;
      if (filter.projectId && m.projectId !== filter.projectId) continue;
      if (filter.status && m.status !== filter.status) continue;
      if (filter.sensitivity && m.sensitivity !== filter.sensitivity) continue;
      out.push({ ...m });
    }
    return out;
  }

  update(id: string, patch: Partial<Memory>): Memory | undefined {
    const existing = this.memories.get(id);
    if (!existing) return undefined;
    const updated: Memory = { ...existing, ...patch };
    this.memories.set(id, updated);
    if (patch.text !== undefined) {
      // Re-index only on text change so status-only updates don't drop from BM25.
      this.bm25.add(id, patch.text);
    }
    if (patch.embedding) {
      this.int8Cache.set(id, quantizeInt8(patch.embedding.values));
    }
    return { ...updated };
  }

  /** PRD 9.3 step 5: "Forget is a real deletion of the row and its embedding." */
  forget(id: string): ForgetResult {
    const existing = this.memories.get(id);
    if (!existing) return { removed: false, removedDerivedCount: 0 };

    const derivedIds: string[] = [];
    for (const [mid, m] of this.memories) {
      if (m.supersedesId === id && mid !== id) derivedIds.push(mid);
    }
    for (const did of derivedIds) this.removeOne(did);
    this.removeOne(id);

    return { removed: true, removedDerivedCount: derivedIds.length };
  }

  private removeOne(id: string): void {
    const m = this.memories.get(id);
    if (!m) return;
    this.memories.delete(id);
    this.byUser.get(m.userId)?.delete(id);
    this.bm25.remove(id);
    this.int8Cache.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Retrieval (PRD 9.6)
  // ---------------------------------------------------------------------------

  search(
    userId: string,
    query: string,
    options: SearchOptions = {},
  ): { hits: RetrievalHit[]; log: RetrievalLog } {
    const now = options.now ?? this.clock.now();
    const limit = options.limit ?? 10;

    // Step 1 — keyword (BM25)
    const bm25Hits = this.bm25.search(query);
    const bm25Map = new Map(bm25Hits.map((h) => [h.id, h.score]));
    const bm25Max = Math.max(1, ...bm25Hits.map((h) => h.score));

    // Step 2 — vector (cosine over int8 cache)
    const cosineMap = new Map<string, number>();
    let cosineMax = 1;
    if (options.queryEmbedding) {
      for (const [id, int8] of this.int8Cache) {
        const m = this.memories.get(id);
        if (!m || m.userId !== userId) continue;
        const score = cosineFloat(options.queryEmbedding, dequantizeInt8(int8));
        if (score > 0) {
          cosineMap.set(id, score);
          if (score > cosineMax) cosineMax = score;
        }
      }
    }

    // Step 3 — merge and rerank
    const candidates = new Set<string>([...bm25Map.keys(), ...cosineMap.keys()]);
    const bm25W = options.bm25Weight ?? 0.5;
    const cosineW = options.cosineWeight ?? 0.5;
    const recencyW = options.recencyWeight ?? 0.05;
    const importanceW = options.importanceWeight ?? 0.05;
    const projectMatchBonus = options.projectMatchBonus ?? 0.1;
    const pinBonus = options.pinBonus ?? 0.2;

    const hits: RetrievalHit[] = [];
    for (const id of candidates) {
      const m = this.memories.get(id);
      if (!m || m.userId !== userId) continue;

      // Filters — PRD 9.6
      if (m.status === 'forgotten' || m.status === 'archived') continue;
      if (m.frozen) continue;
      if (m.sensitivity === 'S2' && m.status === 'pending_approval') continue;
      if (options.type && m.type !== options.type) continue;
      if (options.projectId && m.projectId && m.projectId !== options.projectId) continue;

      const bm25Score = (bm25Map.get(id) ?? 0) / bm25Max;
      const cosineScore = (cosineMap.get(id) ?? 0) / cosineMax;
      const recency = recencyScore(m.createdAt, now);
      const importance = Math.min(1, (m.importance || 1.5) / 5);
      const projectMatch =
        options.projectId && m.projectId === options.projectId ? projectMatchBonus : 0;
      const pin = m.pinned ? pinBonus : 0;

      const finalScore =
        bm25W * bm25Score +
        cosineW * cosineScore +
        recencyW * recency +
        importanceW * importance +
        projectMatch +
        pin;

      if (finalScore <= 0) continue;

      const why: string[] = [];
      if (bm25Score > 0) why.push('keyword');
      if (cosineScore > 0) why.push('semantic');
      if (projectMatch > 0) why.push('project');
      if (pin > 0) why.push('pinned');
      if (recency >= 0.7) why.push('recent');

      hits.push({
        memory: { ...m },
        bm25Score,
        cosineScore,
        finalScore,
        why: why.join(', ') || 'ranked',
      });
    }

    hits.sort((a, b) => b.finalScore - a.finalScore);
    const limited = hits.slice(0, limit);

    const log: RetrievalLog = {
      query,
      at: now,
      hits: limited.map((h) => ({
        memoryId: h.memory.id,
        finalScore: h.finalScore,
        why: h.why,
      })),
    };
    this.retrievalLog.push(log);

    return { hits: limited, log };
  }

  // ---------------------------------------------------------------------------
  // Context card (PRD 9.8)
  // ---------------------------------------------------------------------------

  contextCard(memoryIds: string[]): ContextCard {
    const memories: Memory[] = [];
    for (const id of memoryIds) {
      const m = this.memories.get(id);
      if (m) memories.push({ ...m });
    }
    const count = memories.length;
    return {
      memoryIds: memories.map((m) => m.id),
      memories,
      count,
      label:
        count === 0
          ? 'No memories used'
          : count === 1
            ? 'Used 1 memory'
            : `Used ${count} memories`,
    };
  }

  // ---------------------------------------------------------------------------
  // Review queue (PRD 9.3 step 4)
  // ---------------------------------------------------------------------------

  reviewQueue(userId: string, now?: number): Memory[] {
    const t = now ?? this.clock.now();
    return this.list({ userId, status: 'active' }).filter(
      (m) => m.reviewAt !== undefined && m.reviewAt <= t,
    );
  }

  review(userId: string, id: string, decision: ReviewDecision): Memory | undefined {
    const m = this.memories.get(id);
    if (!m || m.userId !== userId) return undefined;

    if (decision.action === 'forget') {
      this.forget(id);
      return undefined;
    }
    if (decision.action === 'expire') {
      return this.update(id, { status: 'needs_review' });
    }
    if (decision.action === 'keep') {
      const patch: Partial<Memory> = {
        status: 'active',
        lastVerifiedAt: this.clock.now(),
      };
      if (m.reviewAt !== undefined) {
        patch.reviewAt = this.clock.now() + 14 * DAY_MS;
      }
      return this.update(id, patch);
    }
    if (decision.action === 'merge' && decision.mergeInto) {
      // `supersedesId` is part of the curator Memory type; cast keeps TS quiet
      // if a trimmed stub omitted it.
      return this.update(id, {
        status: 'archived',
        supersedesId: decision.mergeInto,
      } as Partial<Memory>);
    }
    return { ...m };
  }

  // ---------------------------------------------------------------------------
  // Prune expired (PRD 9.2, FR-MEM-06)
  // ---------------------------------------------------------------------------

  pruneExpired(userId: string, now?: number): PruneResult {
    const t = now ?? this.clock.now();
    let moved = 0;
    for (const m of this.list({ userId, status: 'active' })) {
      if (m.expiresAt !== undefined && m.expiresAt <= t) {
        this.update(m.id, { status: 'needs_review' });
        moved += 1;
      }
    }
    return { movedToReview: moved };
  }

  // ---------------------------------------------------------------------------
  // Diagnostics (FR-MEM-13 "Why this memory?")
  // ---------------------------------------------------------------------------

  retrievalLogs(): RetrievalLog[] {
    // Deep clone so callers cannot mutate internal state.
    return this.retrievalLog.map((l) => ({
      ...l,
      hits: l.hits.map((h) => ({ ...h })),
    }));
  }

  size(): number {
    return this.memories.size;
  }

  clear(): void {
    this.memories.clear();
    this.byUser.clear();
    this.bm25.clear();
    this.int8Cache.clear();
    this.retrievalLog.length = 0;
  }
}

function recencyScore(createdAt: number, now: number): number {
  const age = now - createdAt;
  if (age < DAY_MS) return 1;
  if (age < 7 * DAY_MS) return 0.7;
  if (age < 30 * DAY_MS) return 0.4;
  if (age < 90 * DAY_MS) return 0.2;
  return 0.1;
}