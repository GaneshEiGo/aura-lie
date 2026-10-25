// packages/memory-curator/src/index.ts
// Section 49 (rebuilt): memory curation pipeline per PRD 9.2, 9.5.
// candidate → importance → duplicate → privacy → expiry → contradiction → store/ask/discard.
//
// Exports both the types that @aura-lie/memory-store depends on
// and the pipeline primitives that Section 67's MemoryStore.curate
// tests would exercise.

// =============================================================================
// Types (shared with @aura-lie/memory-store)
// =============================================================================

export type MemoryType = 'episodic' | 'semantic' | 'project' | 'temporal';
export type MemoryOrigin =
  | 'USER'
  | 'FILE'
  | 'WEB'
  | 'MODEL'
  | 'DERIVED'
  | 'INFERRED'
  | 'UNKNOWN';
export type MemoryStatus =
  | 'active'
  | 'needs_review'
  | 'archived'
  | 'forgotten'
  | 'pending_approval';
export type Sensitivity = 'S0' | 'S1' | 'S2';

export interface Embedding {
  values: number[];
}

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  text: string;
  origin: MemoryOrigin;
  createdAt: number;
  lastVerifiedAt: number;
  importance: number;
  sensitivity: Sensitivity;
  pinned: boolean;
  frozen: boolean;
  status: MemoryStatus;
  provenanceFloor: MemoryOrigin;
  projectId?: string;
  reviewAt?: number;
  expiresAt?: number;
  supersedesId?: string;
  embedding?: Embedding;
  sourceMessageId?: string;
  sourceFileId?: string;
  embeddingModel?: string;
}

export interface MemoryCandidate {
  text: string;
  type: MemoryType;
  origin: MemoryOrigin;
  importance: number;
  sensitivity: Sensitivity;
  projectId?: string;
  sourceMessageId?: string;
  sourceFileId?: string;
  expiresInDays?: number;
  reviewInDays?: number;
  embedding?: Embedding;
}

// =============================================================================
// Constants — PRD 9.2 lifetime table
// =============================================================================

const DEFAULT_LIFETIME_DAYS: Record<MemoryType, number | null> = {
  episodic: 180,   // PRD 9.2: 180 days, then summarised
  semantic: null,  // until changed or forgotten
  project: null,   // life of the project
  temporal: 14,    // PRD 9.2: review in 14 days
};

const S2_KEYWORDS = [
  'password', 'credit card', 'social security', 'aadhaar', 'pan card',
  'bank account', 'medical', 'diagnosis', 'therapy', 'prescription',
  'salary', 'income', 'debt', 'loan', 'relationship', 'divorce',
  'anxiety', 'depression', 'suicidal', 'self-harm', 'private',
];

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{20,}/,
  /pk_[A-Za-z0-9_\-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /api[_-]?key["'\s:=]+[A-Za-z0-9_\-]{16,}/i,
];

const CHITCHAT_MARKERS = new Set([
  'hi', 'hello', 'hey', 'thanks', 'thank you', 'thx', 'ok', 'okay', 'k',
  'cool', 'nice', 'lol', 'haha', 'bye', 'goodbye', 'good morning',
  'good night', 'gm', 'gn', 'yes', 'no', 'sure', 'great',
]);

const DAY_MS = 86_400_000;

// =============================================================================
// Pure math — reused by the memory-store
// =============================================================================

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// =============================================================================
// Pipeline stage 1 — importance
// =============================================================================

export function isDurable(candidate: MemoryCandidate): boolean {
  const raw = candidate.text.trim();
  if (raw.length < 5) return false;
  if (CHITCHAT_MARKERS.has(raw.toLowerCase())) return false;
  if (candidate.importance < 1) return false;
  return true;
}

// =============================================================================
// Pipeline stage 2 — duplicate
// =============================================================================

export function findDuplicate(
  candidate: MemoryCandidate,
  existing: readonly Memory[],
  threshold = 0.92,
): Memory | undefined {
  if (candidate.embedding && candidate.embedding.values.length > 0) {
    let best: { m: Memory; score: number } | undefined;
    for (const m of existing) {
      if (m.status !== 'active') continue;
      if (!m.embedding || m.embedding.values.length === 0) continue;
      const score = cosine(candidate.embedding.values, m.embedding.values);
      if (score >= threshold && (!best || score > best.score)) {
        best = { m, score };
      }
    }
    return best?.m;
  }
  const lower = candidate.text.trim().toLowerCase();
  for (const m of existing) {
    if (m.status !== 'active') continue;
    if (m.text.trim().toLowerCase() === lower) return m;
  }
  return undefined;
}

// =============================================================================
// Pipeline stage 3 — privacy
// =============================================================================

export function containsSecret(text: string): boolean {
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

export function classifySensitivity(
  text: string,
  hint: Sensitivity = 'S0',
): Sensitivity {
  if (hint === 'S2') return 'S2';
  const lower = text.toLowerCase();
  for (const kw of S2_KEYWORDS) {
    if (lower.includes(kw)) return 'S2';
  }
  return hint;
}

// =============================================================================
// Pipeline stage 4 — expiry
// =============================================================================

export function defaultLifetime(type: MemoryType): number | null {
  return DEFAULT_LIFETIME_DAYS[type];
}

export interface ExpiryResult {
  expiresAt?: number;
  reviewAt?: number;
}

export function computeExpiry(
  type: MemoryType,
  now: number,
  candidate: MemoryCandidate,
): ExpiryResult {
  if (candidate.expiresInDays !== undefined) {
    return { expiresAt: now + candidate.expiresInDays * DAY_MS };
  }
  if (candidate.reviewInDays !== undefined) {
    return { reviewAt: now + candidate.reviewInDays * DAY_MS };
  }
  const days = DEFAULT_LIFETIME_DAYS[type];
  if (days === null) return {};
  if (type === 'temporal') {
    return { reviewAt: now + days * DAY_MS };
  }
  return { expiresAt: now + days * DAY_MS };
}

// =============================================================================
// Pipeline stage 5 — contradiction
// =============================================================================

const OPPOSITE_PAIRS: ReadonlyArray<[string, string]> = [
  ['prefers', 'dislikes'],
  ['likes', 'hates'],
  ['loves', 'avoids'],
  ['wants', 'does not want'],
  ['uses', 'does not use'],
  ['is', 'is not'],
];

export function findContradiction(
  candidate: MemoryCandidate,
  existing: readonly Memory[],
): Memory | undefined {
  const lower = candidate.text.toLowerCase();
  for (const m of existing) {
    if (m.status !== 'active') continue;
    if (m.type !== candidate.type) continue;
    const mtext = m.text.toLowerCase();
    for (const [pos, neg] of OPPOSITE_PAIRS) {
      if (lower.includes(pos) && mtext.includes(neg)) return m;
      if (lower.includes(neg) && mtext.includes(pos)) return m;
    }
  }
  return undefined;
}

// =============================================================================
// Orchestrator
// =============================================================================

export type CuratorAction = 'store' | 'ask' | 'discard';

export interface CuratorDecision {
  action: CuratorAction;
  memory?: Memory;
  reason: string;
  mergedInto?: string;
  superseded?: string;
}

export interface CuratorOptions {
  clock?: { now(): number };
  idGenerator?: () => string;
}

let _idCounter = 0;
function defaultIdGenerator(): string {
  _idCounter += 1;
  return `mem_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

export class MemoryCurator {
  private readonly existing: Memory[] = [];
  private readonly clock: { now(): number };
  private readonly idGenerator: () => string;

  constructor(options: CuratorOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  setExisting(memories: readonly Memory[]): void {
    this.existing.length = 0;
    for (const m of memories) this.existing.push(m);
  }

  addExisting(memory: Memory): void {
    this.existing.push(memory);
  }

  list(): Memory[] {
    return this.existing.map((m) => ({ ...m }));
  }

  curate(candidate: MemoryCandidate, userId = 'u1'): CuratorDecision {
    const now = this.clock.now();

    // 1. Importance
    if (!isDurable(candidate)) {
      return { action: 'discard', reason: 'not_durable' };
    }

    // 2. Privacy — secrets are never stored, ever
    if (containsSecret(candidate.text)) {
      return { action: 'discard', reason: 'contains_secret' };
    }

    // 3. Sensitivity classification (rules first, hint preserved)
    const sensitivity = classifySensitivity(candidate.text, candidate.sensitivity);

    // 4. Duplicate
    const dup = findDuplicate(candidate, this.existing);
    if (dup) {
      const merged: Memory = {
        ...dup,
        importance: Math.max(dup.importance, candidate.importance),
        lastVerifiedAt: now,
        text: candidate.text,
        sensitivity,
      };
      const idx = this.existing.findIndex((m) => m.id === dup.id);
      if (idx >= 0) this.existing[idx] = merged;
      return {
        action: 'store',
        memory: merged,
        reason: 'merged_duplicate',
        mergedInto: dup.id,
      };
    }

    // 5. Contradiction — latest explicit user statement wins (PRD 9.5)
    const contradiction = findContradiction(candidate, this.existing);
    let supersedesId: string | undefined;
    if (
      contradiction &&
      contradiction.origin === 'USER' &&
      candidate.origin === 'USER'
    ) {
      const idx = this.existing.findIndex((m) => m.id === contradiction.id);
      if (idx >= 0) {
        this.existing[idx] = { ...contradiction, status: 'archived' };
      }
      supersedesId = contradiction.id;
    }

    // 6. Expiry
    const { expiresAt, reviewAt } = computeExpiry(candidate.type, now, candidate);

    // 7. S2 requires approval, secrets excluded already
    const needsApproval = sensitivity === 'S2';

    const memory: Memory = {
      id: this.idGenerator(),
      userId,
      type: candidate.type,
      text: candidate.text,
      origin: candidate.origin,
      createdAt: now,
      lastVerifiedAt: now,
      importance: candidate.importance,
      sensitivity,
      pinned: false,
      frozen: false,
      status: needsApproval ? 'pending_approval' : 'active',
      provenanceFloor: candidate.origin,
      projectId: candidate.projectId,
      sourceMessageId: candidate.sourceMessageId,
      sourceFileId: candidate.sourceFileId,
      embedding: candidate.embedding,
      expiresAt,
      reviewAt,
      supersedesId,
    };

    if (!needsApproval) this.existing.push(memory);

    return {
      action: needsApproval ? 'ask' : 'store',
      memory,
      reason: needsApproval
        ? 's2_needs_approval'
        : supersedesId
          ? 'supersedes_old'
          : 'stored',
      superseded: supersedesId,
    };
  }
}