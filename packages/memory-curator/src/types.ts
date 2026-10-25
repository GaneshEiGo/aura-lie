// packages/memory-curator/src/types.ts
// PRD 9.2, 9.3, 9.4, 9.5, 9.8.

export type MemoryType = 'episodic' | 'semantic' | 'project' | 'temporal';

export type MemoryOrigin =
  | 'USER'
  | 'FILE'
  | 'WEB'
  | 'MODEL'
  | 'DERIVED'
  | 'INFERRED'
  | 'UNKNOWN';

export type Sensitivity = 'S0' | 'S1' | 'S2';

export type MemoryStatus =
  | 'active'
  | 'needs_review'
  | 'archived'
  | 'forgotten'
  | 'pending_approval';

export interface EmbeddingVector {
  values: number[];
}

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  text: string;
  subject?: string;
  origin: MemoryOrigin;
  sourceMessageId?: string;
  sourceFileId?: string;
  projectId?: string;
  createdAt: number;
  lastVerifiedAt: number;
  expiresAt?: number;
  reviewAt?: number;
  importance: number;
  sensitivity: Sensitivity;
  pinned: boolean;
  frozen: boolean;
  status: MemoryStatus;
  supersedesId?: string;
  embedding?: EmbeddingVector;
  embeddingModel?: string;
  /**
   * PRD 9.4: "MODEL, INFERRED and UNKNOWN can never be promoted to a stronger
   * origin by repetition." This is the weakest origin ever seen for this memory.
   */
  provenanceFloor: MemoryOrigin;
}

export interface MemoryCandidate {
  text: string;
  type: MemoryType;
  origin: MemoryOrigin;
  sensitivity: Sensitivity;
  subject?: string;
  sourceMessageId?: string;
  sourceFileId?: string;
  projectId?: string;
  embedding?: EmbeddingVector;
  embeddingModel?: string;
  /** Explicit "remember this" — bypasses the importance gate. */
  userExplicitRemember?: boolean;
  pinned?: boolean;
}

export type CuratorStage =
  | 'importance'
  | 'duplicate'
  | 'privacy'
  | 'expiry'
  | 'contradiction';

export type CuratorDecision =
  | { kind: 'stored'; memory: Memory }
  | { kind: 'merged'; memory: Memory; mergedInto: string }
  | { kind: 'discarded'; reason: string; stage: CuratorStage }
  | { kind: 'pending_approval'; memory: Memory }
  | {
      kind: 'contradicted';
      memory: Memory;
      superseded: string;
      message: string;
    };

export interface CuratorResult {
  decisions: CuratorDecision[];
  stored: number;
  merged: number;
  discarded: number;
  pendingApproval: number;
  contradicted: number;
}

export interface Clock {
  now(): number;
}

export interface CuratorOptions {
  /** PRD 9.5: "Cosine similarity above 0.92 with an existing memory merges". */
  duplicateThreshold?: number;
  clock?: Clock;
}

export interface ContextCard {
  memoryIds: string[];
  count: number;
  label: string;
}