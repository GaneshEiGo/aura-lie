// packages/memory-curator/src/curator.ts
// The Memory Curator pipeline from PRD 9.5.

import type {
  Clock,
  ContextCard,
  CuratorDecision,
  CuratorOptions,
  CuratorResult,
  Memory,
  MemoryCandidate,
  MemoryOrigin,
} from './types.js';
import { assessImportance } from './importance.js';
import { looksLikeSecret } from './secrets.js';
import { cosine } from './similarity.js';
import { assignExpiry } from './expiry.js';
import { detectContradiction } from './contradiction.js';
import { MemoryStore } from './store.js';

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_IMPORTANCE = 1.5; // PRD 9.3

const ORIGIN_RANK: Record<MemoryOrigin, number> = {
  USER: 5,
  FILE: 4,
  WEB: 3,
  DERIVED: 2,
  MODEL: 1,
  INFERRED: 1,
  UNKNOWN: 0,
};

export class MemoryCurator {
  private readonly store: MemoryStore;
  private readonly clock: Clock;
  private readonly duplicateThreshold: number;
  private counter = 0;

  constructor(store: MemoryStore, options: CuratorOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.duplicateThreshold =
      options.duplicateThreshold ?? DEFAULT_THRESHOLD;
  }

  curate(userId: string, candidates: MemoryCandidate[]): CuratorResult {
    const decisions: CuratorDecision[] = [];
    for (const candidate of candidates) {
      decisions.push(this.curateOne(userId, candidate));
    }
    return {
      decisions,
      stored: decisions.filter((d) => d.kind === 'stored').length,
      merged: decisions.filter((d) => d.kind === 'merged').length,
      discarded: decisions.filter((d) => d.kind === 'discarded').length,
      pendingApproval: decisions.filter((d) => d.kind === 'pending_approval').length,
      contradicted: decisions.filter((d) => d.kind === 'contradicted').length,
    };
  }

  curateOne(userId: string, candidate: MemoryCandidate): CuratorDecision {
    // -- 1. Importance ------------------------------------------------
    // PRD 9.5: "durable, reusable, likely to matter again. Chit-chat is
// discarded." A candidate carrying a `subject` (PRD 9.3) is declaring
// "this is a durable fact about X" — the semantic anchor is what makes
// it storable, not the text length. Same for `userExplicitRemember`.
const bypassImportance = !!candidate.userExplicitRemember || !!candidate.subject;
if (!bypassImportance) {
  const assessment = assessImportance(candidate.text);
  if (assessment.verdict === 'discard') {
    return {
      kind: 'discarded',
      reason: assessment.reason,
      stage: 'importance',
    };
  }
}

    // -- 2. Duplicate -------------------------------------------------
    const activeMemories = this.store.listActive(userId);
    if (candidate.embedding) {
      for (const memory of activeMemories) {
        if (!memory.embedding) continue;
        const sim = cosine(candidate.embedding.values, memory.embedding.values);
        if (sim >= this.duplicateThreshold) {
          const merged = this.store.update(memory.id, {
            lastVerifiedAt: this.clock.now(),
            origin: weakerOrigin(memory.origin, candidate.origin),
            provenanceFloor: weakerOrigin(
              memory.provenanceFloor,
              candidate.origin,
            ),
          });
          return {
            kind: 'merged',
            memory: merged!,
            mergedInto: memory.id,
          };
        }
      }
    }

    // -- 3. Privacy ---------------------------------------------------
    if (looksLikeSecret(candidate.text)) {
      return {
        kind: 'discarded',
        reason: 'contains secret',
        stage: 'privacy',
      };
    }
    if (candidate.sensitivity === 'S2') {
      const memory = this.buildMemory(userId, candidate);
      const expiry = assignExpiry(candidate.type, this.clock.now());
      memory.expiresAt = expiry.expiresAt;
      memory.reviewAt = expiry.reviewAt;
      memory.status = 'pending_approval';
      this.store.add(memory);
      return { kind: 'pending_approval', memory };
    }

    // -- 4. Expiry ----------------------------------------------------
    const expiry = assignExpiry(candidate.type, this.clock.now());

    // -- 5. Contradiction ---------------------------------------------
    const contradiction = detectContradiction(candidate, activeMemories);

    const memory = this.buildMemory(userId, candidate);
    memory.expiresAt = expiry.expiresAt;
    memory.reviewAt = expiry.reviewAt;

    if (contradiction.contradicts && contradiction.existing) {
      this.store.update(contradiction.existing.id, {
        status: 'archived',
      });
      memory.supersedesId = contradiction.existing.id;
      this.store.add(memory);
      return {
        kind: 'contradicted',
        memory,
        superseded: contradiction.existing.id,
        message: contradiction.message!,
      };
    }

    this.store.add(memory);
    return { kind: 'stored', memory };
  }

  /** PRD 9.8: "Used N memories" context card. */
  getContextCard(usedIds: string[]): ContextCard {
    const valid = usedIds.filter((id) => this.store.get(id) !== undefined);
    const count = valid.length;
    return {
      memoryIds: valid,
      count,
      label:
        count === 0
          ? 'No memories used'
          : count === 1
            ? 'Used 1 memory'
            : `Used ${count} memories`,
    };
  }

  private buildMemory(userId: string, candidate: MemoryCandidate): Memory {
    const now = this.clock.now();
    const id = `mem-${String(++this.counter).padStart(6, '0')}`;
    return {
      id,
      userId,
      type: candidate.type,
      text: candidate.text,
      subject: candidate.subject,
      origin: candidate.origin,
      sourceMessageId: candidate.sourceMessageId,
      sourceFileId: candidate.sourceFileId,
      projectId: candidate.projectId,
      createdAt: now,
      lastVerifiedAt: now,
      importance: DEFAULT_IMPORTANCE,
      sensitivity: candidate.sensitivity,
      pinned: candidate.pinned ?? false,
      frozen: false,
      status: 'active',
      embedding: candidate.embedding,
      embeddingModel: candidate.embeddingModel,
      provenanceFloor: candidate.origin,
    };
  }
}

function weakerOrigin(a: MemoryOrigin, b: MemoryOrigin): MemoryOrigin {
  return ORIGIN_RANK[a] <= ORIGIN_RANK[b] ? a : b;
}