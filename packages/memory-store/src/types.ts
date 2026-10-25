// packages/memory-store/src/types.ts
// PRD 9.3, 9.6, 9.8 · FR-MEM-04, FR-MEM-06, FR-MEM-13.
// Every type here is either consumed by the store at runtime
// or is a pure type re-export from the curator package.

import type {
  Memory as CuratorMemory,
  MemoryType,
  MemoryOrigin,
  MemoryStatus,
  Sensitivity,
} from '@aura-lie/memory-curator';

export type Memory = CuratorMemory;
export type { MemoryType, MemoryOrigin, MemoryStatus, Sensitivity };

/** PRD 9.6 step 2: brute-force cosine over cached int8 vectors. */
export interface Int8Vector {
  values: Int8Array;
}

/** PRD 9.6 step 5: "why each was chosen". */
export interface RetrievalHit {
  memory: Memory;
  bm25Score: number;
  cosineScore: number;
  finalScore: number;
  why: string;
}

/** FR-MEM-13 "Why this memory?" log entry. */
export interface RetrievalLog {
  query: string;
  at: number;
  hits: Array<{ memoryId: string; finalScore: number; why: string }>;
}

export interface SearchOptions {
  limit?: number;
  type?: MemoryType;
  projectId?: string;
  now?: number;
  /** PRD 9.6: query embeddings come from Workers AI. */
  queryEmbedding?: number[];
  bm25Weight?: number;
  cosineWeight?: number;
  recencyWeight?: number;
  importanceWeight?: number;
  projectMatchBonus?: number;
  pinBonus?: number;
}

/** PRD 9.8: "Used N memories" context card. */
export interface ContextCard {
  memoryIds: string[];
  memories: Memory[];
  count: number;
  label: string;
}

export type ReviewAction = 'keep' | 'merge' | 'expire' | 'forget';

export interface ReviewDecision {
  action: ReviewAction;
  mergeInto?: string;
}

export interface PruneResult {
  movedToReview: number;
}

export interface ForgetResult {
  removed: boolean;
  removedDerivedCount: number;
}

export interface MemoryStoreOptions {
  clock?: { now(): number };
}

/** IndexedDB adapter shape. Caller provides the real browser bindings. */
export interface IndexedDbAdapter {
  loadAll(userId: string): Promise<Memory[]>;
  saveOne(memory: Memory): Promise<void>;
  deleteOne(id: string): Promise<void>;
}

/** PRD 9.9: optional encrypted sync to Cloudflare D1. */
export interface D1SyncAdapter {
  push(profileId: string, ciphertext: Uint8Array): Promise<void>;
  pull(profileId: string): Promise<Uint8Array | null>;
}

/** Convenience: filter object for `store.list()`. */
export interface ListFilter {
  userId: string;
  type?: MemoryType;
  projectId?: string;
  status?: MemoryStatus;
  sensitivity?: Sensitivity;
}