// === FILE START ===
// packages/memory-store/src/curator-v2.ts
// PRD 9.2 · 9.5 · FR-MEM-01 to FR-MEM-15 · T-24.
//
// The memory curator. PRD 9.5 pipeline (order matters):
//
//   secrets (hard discard, always)
//   → S2 approval (ask — never silently discarded)
//   → importance test (chit-chat discarded)
//   → type + expiry classification
//   → duplicate test (cosine 0.92)
//   → contradiction test (same verb, different value)
//   → store
//
// Section 86 FIX (this revision):
//   Two bugs caught by t24-curator.test.ts:
//
//   Bug 1 — "different topics" was flagged as contradiction.
//     Old pattern /i (?:prefer|like|love|use)\s+(\w+)/i captured only the
//     VALUE. "I like cats" (value=cats) vs "I prefer coffee" (value=coffee)
//     looked like different values on the same slot. Fix: capture the VERB
//     too and require verb equality.
//
//   Bug 2 — secrets and S2 were silently discarded as chit-chat.
//     The importance stage ran FIRST, so "my password is hunter2" (not a
//     durable keyword, not a known chit-chat keyword) defaulted to chit-chat
//     and was discarded before privacy could classify it as SECRET. Same for
//     "I have a health condition." (S2). Fix: reorder stages. Secret is a
//     hard gate; S2 requires explicit approval and is exempt from the
//     chit-chat discard.

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type MemoryType = 'episodic' | 'semantic' | 'project' | 'temporal';
export type Sensitivity = 'S0' | 'S1' | 'S2' | 'secret';
export type ImportanceLabel = 'durable' | 'chitchat';
export type CuratorAction = 'store' | 'ask' | 'discard' | 'merge' | 'archive';

export interface CuratorCandidate {
  id: string;
  text: string;
  origin?: 'USER' | 'FILE' | 'WEB' | 'MODEL' | 'DERIVED' | 'INFERRED';
}

export interface ExistingMemory {
  id: string;
  text: string;
  embedding?: number[];
  type: MemoryType;
  sensitivity: Sensitivity;
  createdAt: number;
  pinned?: boolean;
  frozen?: boolean;
}

export interface CuratorDecision {
  candidateId: string;
  action: CuratorAction;
  reason: string;
  type?: MemoryType;
  sensitivity?: Sensitivity;
  importance?: ImportanceLabel;
  expiresAt?: number | null;
  duplicateOf?: string;
  supersedesId?: string;
  similarity?: number;
}

export interface CuratorResult {
  decisions: CuratorDecision[];
  toStore: CuratorCandidate[];
  toAsk: CuratorCandidate[];
  toDiscard: CuratorCandidate[];
  merges: Array<{ candidateId: string; targetId: string; similarity: number }>;
  archives: Array<{ archivedId: string; replacedBy: string }>;
}

export interface CuratorOptions {
  now?: () => number;
  embeddingFn?: (text: string) => number[];
  duplicateThreshold?: number;
  /** When true, S2 requires approval (default true per PRD 9.5). */
  requireApprovalForS2?: boolean;
}

// -----------------------------------------------------------------------------
// Constants (PRD 9.2 · 9.5)
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const EPISODIC_LIFETIME_MS = 180 * DAY_MS;
export const TEMPORAL_REVIEW_MS = 14 * DAY_MS;
export const DUPLICATE_THRESHOLD = 0.92;

// -----------------------------------------------------------------------------
// Importance classification
// -----------------------------------------------------------------------------

const DURABLE_KEYWORDS = [
  'i prefer',
  'i like',
  'i love',
  'i hate',
  'remember that',
  'my goal',
  'my project',
  'my name is',
  'i work at',
  'i live in',
  'i am learning',
  "i'm learning",
  'my job',
  'my dog',
  'my cat',
  'my team',
  'deadline',
  'my deadline',
  'my birthday',
  'my address',
  'my email',
];

const CHITCHAT_KEYWORDS = [
  'how are you',
  'nice weather',
  'good morning',
  'good night',
  'haha',
  'lol',
  'thanks',
  'thank you',
  'ok',
  'okay',
  'great',
  'awesome',
  'cool',
  'hey',
  'hello',
  'hi ',
];

export function classifyImportance(text: string): ImportanceLabel {
  const t = text.toLowerCase().trim();
  if (t.length < 12) return 'chitchat';
  for (const k of CHITCHAT_KEYWORDS) {
    if (t === k || t.startsWith(k + ' ') || t === k + '!') return 'chitchat';
  }
  for (const k of DURABLE_KEYWORDS) {
    if (t.includes(k)) return 'durable';
  }
  // Default: chit-chat (erring away from storing noise)
  return 'chitchat';
}

// -----------------------------------------------------------------------------
// Type classification
// -----------------------------------------------------------------------------

const TEMPORAL_KEYWORDS = [
  'tomorrow',
  'today',
  'this week',
  'next week',
  'this month',
  'due',
  'deadline',
  'interview',
  'meeting at',
  'on monday',
  'on tuesday',
  'on wednesday',
  'on thursday',
  'on friday',
  'on saturday',
  'on sunday',
  'in 2 days',
  'in 3 days',
  'this friday',
  'this monday',
];

const PROJECT_KEYWORDS = [
  'my project',
  'in this project',
  'the project',
  'our project',
  'aura-lie',
];

const EPISODIC_KEYWORDS = [
  'yesterday',
  'last week',
  'last month',
  'asked',
  'discussed',
  'mentioned',
  'said',
  'we talked',
];

export function classifyType(text: string): MemoryType {
  const t = text.toLowerCase();
  for (const k of TEMPORAL_KEYWORDS) if (t.includes(k)) return 'temporal';
  for (const k of PROJECT_KEYWORDS) if (t.includes(k)) return 'project';
  for (const k of EPISODIC_KEYWORDS) if (t.includes(k)) return 'episodic';
  return 'semantic';
}

export function computeExpiry(
  type: MemoryType,
  now: number,
): { expiresAt: number | null; reviewAt: number | null } {
  if (type === 'episodic') return { expiresAt: now + EPISODIC_LIFETIME_MS, reviewAt: null };
  if (type === 'temporal') return { expiresAt: now + TEMPORAL_REVIEW_MS, reviewAt: now + TEMPORAL_REVIEW_MS };
  // semantic and project: lifetime of the account / project
  return { expiresAt: null, reviewAt: null };
}

// -----------------------------------------------------------------------------
// Privacy classification
// -----------------------------------------------------------------------------

const SECRET_KEYWORDS = ['password', 'passcode', 'api key', 'apikey', 'secret', 'token', 'private key'];

const S2_KEYWORDS = [
  'health',
  'medical',
  'doctor',
  'therapy',
  'therapist',
  'diagnosis',
  'depression',
  'anxiety',
  'medication',
  'salary',
  'income',
  'bank',
  'credit card',
  'boyfriend',
  'girlfriend',
  'husband',
  'wife',
  'divorce',
  'relationship',
  'pregnant',
  'minor',
  'child',
];

const S1_KEYWORDS = [
  'my project',
  'my goal',
  'my job',
  'my team',
  'i live in',
  'i work at',
  'my company',
  'my office',
  'my city',
];

export function classifyPrivacy(text: string): Sensitivity {
  const t = text.toLowerCase();
  for (const k of SECRET_KEYWORDS) if (t.includes(k)) return 'secret';
  for (const k of S2_KEYWORDS) if (t.includes(k)) return 'S2';
  for (const k of S1_KEYWORDS) if (t.includes(k)) return 'S1';
  return 'S0';
}

// -----------------------------------------------------------------------------
// Duplicate detection
// -----------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function checkDuplicate(
  candidateEmbedding: number[],
  existing: ExistingMemory[],
  threshold: number = DUPLICATE_THRESHOLD,
): { duplicate: boolean; targetId: string | null; similarity: number } {
  let bestId: string | null = null;
  let bestSim = 0;
  for (const mem of existing) {
    if (!mem.embedding) continue;
    const sim = cosineSimilarity(candidateEmbedding, mem.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      bestId = mem.id;
    }
  }
  return { duplicate: bestSim >= threshold, targetId: bestId, similarity: bestSim };
}

// -----------------------------------------------------------------------------
// Contradiction detection
//
// Section 86 FIX: capture both VERB and VALUE. Two preferences only
// contradict when the same verb is used with different values.
//   "I prefer coffee" vs "I prefer tea"  → same verb, diff value → conflict
//   "I like cats"     vs "I prefer coffee" → diff verb → NO conflict
//   "I prefer coffee" vs "I prefer coffee" → same verb, same value → NO conflict
// -----------------------------------------------------------------------------

const PREFERENCE_PATTERN = /i (prefer|like|love|use)\s+(\w+)/i;

export function checkContradiction(
  candidateText: string,
  existing: ExistingMemory[],
): { conflict: boolean; archivesId: string | null; reason: string } {
  const candMatch = candidateText.match(PREFERENCE_PATTERN);
  if (!candMatch) return { conflict: false, archivesId: null, reason: '' };
  const candVerb = candMatch[1].toLowerCase();
  const candValue = candMatch[2].toLowerCase();

  for (const mem of existing) {
    const memMatch = mem.text.match(PREFERENCE_PATTERN);
    if (!memMatch) continue;
    const memVerb = memMatch[1].toLowerCase();
    const memValue = memMatch[2].toLowerCase();
    // Contradiction requires SAME verb and DIFFERENT value.
    if (memVerb === candVerb && memValue !== candValue) {
      return {
        conflict: true,
        archivesId: mem.id,
        reason: `New value "${candValue}" replaces "${memValue}" (same verb "${candVerb}").`,
      };
    }
  }
  return { conflict: false, archivesId: null, reason: '' };
}

// -----------------------------------------------------------------------------
// Pipeline — Section 86 FIX: order matters
// -----------------------------------------------------------------------------

export function runCurator(
  candidates: CuratorCandidate[],
  existing: ExistingMemory[],
  opts: CuratorOptions = {},
): CuratorResult {
  const now = opts.now ?? (() => Date.now());
  const embed = opts.embeddingFn ?? (() => new Array(8).fill(0));
  const threshold = opts.duplicateThreshold ?? DUPLICATE_THRESHOLD;
  const requireApprovalS2 = opts.requireApprovalForS2 ?? true;

  const decisions: CuratorDecision[] = [];
  const toStore: CuratorCandidate[] = [];
  const toAsk: CuratorCandidate[] = [];
  const toDiscard: CuratorCandidate[] = [];
  const merges: Array<{ candidateId: string; targetId: string; similarity: number }> = [];
  const archives: Array<{ archivedId: string; replacedBy: string }> = [];

  // Track in-flight stores so a later candidate can dedupe against an earlier one.
  const inFlight: ExistingMemory[] = [...existing];

  for (const cand of candidates) {
    // Stage 1 — SECRET (hard discard, always before anything else)
    // PRD 9.5: "Secrets and passwords are never stored."
    const sensitivity = classifyPrivacy(cand.text);
    if (sensitivity === 'secret') {
      decisions.push({
        candidateId: cand.id,
        action: 'discard',
        reason: 'contains a secret (never stored)',
        sensitivity,
      });
      toDiscard.push(cand);
      continue;
    }

    // Stage 2 — S2 approval (ask, never silently discarded)
    // PRD 9.5: "S2 content ... needs explicit approval."
    if (sensitivity === 'S2' && requireApprovalS2) {
      const type = classifyType(cand.text);
      const { expiresAt } = computeExpiry(type, now());
      decisions.push({
        candidateId: cand.id,
        action: 'ask',
        reason: 'S2 content requires explicit approval',
        sensitivity,
        type,
        expiresAt,
      });
      toAsk.push(cand);
      continue;
    }

    // Stage 3 — Importance (chit-chat discarded; S2 exempt from discard)
    const importance = classifyImportance(cand.text);
    if (importance === 'chitchat' && sensitivity !== 'S2') {
      decisions.push({
        candidateId: cand.id,
        action: 'discard',
        reason: 'chit-chat (low importance)',
        importance,
        sensitivity,
      });
      toDiscard.push(cand);
      continue;
    }

    // Stage 4 — Type + expiry
    const type = classifyType(cand.text);
    const { expiresAt } = computeExpiry(type, now());

    // Stage 5 — Duplicate (cosine ≥ threshold)
    const candEmb = embed(cand.text);
    const dup = checkDuplicate(candEmb, inFlight, threshold);
    if (dup.duplicate && dup.targetId) {
      decisions.push({
        candidateId: cand.id,
        action: 'merge',
        reason: `duplicate of ${dup.targetId} (sim ${dup.similarity.toFixed(2)} ≥ ${threshold})`,
        importance,
        sensitivity,
        type,
        duplicateOf: dup.targetId,
        similarity: dup.similarity,
      });
      merges.push({ candidateId: cand.id, targetId: dup.targetId, similarity: dup.similarity });
      continue;
    }

    // Stage 6 — Contradiction (same verb, different value)
    const contra = checkContradiction(cand.text, inFlight);

    // Stage 7 — Store (S2 with requireApprovalForS2:false reaches here too)
    decisions.push({
      candidateId: cand.id,
      action: 'store',
      reason: contra.conflict
        ? `store + archive ${contra.archivesId} (${contra.reason})`
        : 'store (passes all gates)',
      importance,
      sensitivity,
      type,
      expiresAt,
      supersedesId: contra.conflict ? (contra.archivesId ?? undefined) : undefined,
    });
    toStore.push(cand);

    if (contra.conflict && contra.archivesId) {
      archives.push({ archivedId: contra.archivesId, replacedBy: cand.id });
    }

    // Register the stored candidate so later candidates can dedupe against it.
    inFlight.push({
      id: cand.id,
      text: cand.text,
      embedding: candEmb,
      type,
      sensitivity,
      createdAt: now(),
    });
  }

  return { decisions, toStore, toAsk, toDiscard, merges, archives };
}
// === FILE END ===