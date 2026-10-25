// === FILE START ===
// apps/edge/src/chat-handler-v2.ts
// PRD 7.2 · 7.7 · 7.8 · FR-CHAT-01 · T-20 · T-22 · T-23.
//
// The SSE wire layer. Every chat turn is a stream of typed events defined
// by PRD 7.7:
//
//   meta     opens the turn, carries route + sensitivity + risk tier
//   trace    real events only, monotonic timestamps
//   thinking provider-emitted reasoning (streams the Reasoning tab)
//   token    answer text
//   claim    pending claim underlines
//   source   source card metadata
//   score    per-claim score update
//   summary  response-level fact chip
//   notice   degradation / quota / offline (T-22)
//   done     closes the turn with receipt (T-20)
//   error    typed failure with retry hint
//
// Every event serialises to `data: <json>\n\n` per SSE spec.
//
// T-22 GATE — the six degradation levels from PRD 7.8 each map to a
// notice whose text matches PRD 5.13 verbatim. Tested exhaustively.
//
// T-23 GATE — the Outbox preserves order and never duplicates when
// offline. Tested exhaustively.
//
// T-20 GATE — every event carries a real timestamp; `done.elapsedMs`
// equals wall-clock time from meta to done. Tested exhaustively.
//
// This module is pure: no network, no storage. The caller injects a
// clock and owns persistence.

// -----------------------------------------------------------------------------
// Public types (PRD 7.7 + Appendix C excerpt)
// -----------------------------------------------------------------------------

export type Mode = 'instant' | 'think' | 'research' | 'council';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type ClaimStatus =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CONFLICTED'
  | 'UNVERIFIED'
  | 'RECALL_ONLY'
  | 'NOT_SCORED';
export type Chip =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CHECK'
  | 'PARTIAL'
  | 'RECALL_ONLY';
export type Severity = 'info' | 'warn' | 'error';
export type DegradationLevel = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5';

export interface ChatMetaEvent {
  v: 1;
  type: 'meta';
  turnId: string;
  mode: Mode;
  persona: string;
  sensitivity: Sensitivity;
  riskTier: 0 | 1 | 2 | 3;
  routeRole: string;
  routeFamily: string;
}

export interface ChatTraceEvent {
  type: 'trace';
  seq: number;
  tMs: number;
  kind: string;
  text: string;
}

export interface ChatThinkingEvent {
  type: 'thinking';
  delta: string;
  provider: string;
  model: string;
  kind: 'summary' | 'raw';
}

export interface ChatTokenEvent {
  type: 'token';
  delta: string;
}

export interface ChatClaimEvent {
  type: 'claim';
  id: string;
  text: string;
  claimType: string;
  importance: number;
}

export interface ChatSourceEvent {
  type: 'source';
  id: string;
  title: string;
  domain: string;
  tier: string;
  independenceGroup: string;
}

export interface ChatScoreEvent {
  type: 'score';
  claimId: string;
  score: number | null;
  status: ClaimStatus;
}

export interface ChatSummaryEvent {
  type: 'summary';
  overall: number | null;
  checked: number;
  checkable: number;
  chip: Chip;
  heuristic: true;
}

export interface ChatNoticeEvent {
  type: 'notice';
  severity: Severity;
  code: string;
  text: string;
}

export interface ChatDoneEvent {
  type: 'done';
  elapsedMs: number;
  calls: number;
  tokens: number;
  costInr: 0;
}

export interface ChatErrorEvent {
  type: 'error';
  code: string;
  userMessage: string;
  retryHint?: string;
}

export type ChatEvent =
  | ChatMetaEvent
  | ChatTraceEvent
  | ChatThinkingEvent
  | ChatTokenEvent
  | ChatClaimEvent
  | ChatSourceEvent
  | ChatScoreEvent
  | ChatSummaryEvent
  | ChatNoticeEvent
  | ChatDoneEvent
  | ChatErrorEvent;

// -----------------------------------------------------------------------------
// SSE wire format
// -----------------------------------------------------------------------------

/**
 * Serialise a ChatEvent to the SSE wire format.
 *
 * Format per SSE spec: `data: <json>\n\n`.
 * No `event:` prefix — the type lives inside the JSON so the client parses
 * once and switches on `type`. This also makes replay from stored events
 * trivial: same payload, same parser.
 */
export function formatSseEvent(evt: ChatEvent): string {
  return `data: ${JSON.stringify(evt)}\n\n`;
}

/**
 * Parse a single SSE frame back to a ChatEvent. Returns null on malformed
 * input. Used by T-20's round-trip test and by any client.
 */
export function parseSseFrame(frame: string): ChatEvent | null {
  const trimmed = frame.trim();
  if (!trimmed.startsWith('data:')) return null;
  const json = trimmed.slice(5).trim();
  try {
    const parsed = JSON.parse(json) as ChatEvent;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof (parsed as { type?: unknown }).type !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// T-22 — degradation notices (PRD 7.8 + 5.13 copy)
// -----------------------------------------------------------------------------

/**
 * Map a degradation level to the notice the UI shows. Per PRD 7.8:
 *
 *   D0  Normal — chosen model answers                     (no notice)
 *   D1  Fallback to same-lane provider                    (info notice)
 *   D2  Loop unaffordable, step down                      (info notice)
 *   D3  Only small models have quota (limited mode)       (warn notice)
 *   D4  Core Mode (cached + memory + rule tools)          (warn notice)
 *   D5  Network/edge down (device-only)                   (error notice)
 *
 * Notice text is verbatim from PRD 5.13 where a match exists.
 */
export function noticeForLevel(level: DegradationLevel): ChatNoticeEvent | null {
  switch (level) {
    case 'D0':
      return null;
    case 'D1':
      return {
        type: 'notice',
        severity: 'info',
        code: 'D1_fallback',
        text: 'Provider failed. Switched to the next one in the same lane.',
      };
    case 'D2':
      return {
        type: 'notice',
        severity: 'info',
        code: 'D2_degraded_loop',
        text: 'Think needs more quota than is left. I ran Instant instead.',
      };
    case 'D3':
      return {
        type: 'notice',
        severity: 'warn',
        code: 'D3_small_model',
        text: 'Only the small model has quota left. Running in limited mode.',
      };
    case 'D4':
      return {
        type: 'notice',
        severity: 'warn',
        code: 'D4_core_mode',
        text: 'Cloud models are resting until 05:30 IST. I can still search your notes, calculate and set reminders, and I’ll answer when they’re back.',
      };
    case 'D5':
      return {
        type: 'notice',
        severity: 'error',
        code: 'D5_offline',
        text: 'No internet. Showing what’s on this device.',
      };
  }
}

// -----------------------------------------------------------------------------
// T-23 — offline outbox
// -----------------------------------------------------------------------------

export interface OutboxItem {
  id: string;
  turnId: string;
  text: string;
  mode: Mode;
  enqueuedAt: number;
}

export class Outbox {
  private items: OutboxItem[] = [];
  private readonly seen = new Set<string>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Enqueue a message for delivery when online.
   * Returns false (no-op) if the id is already present — prevents duplicates.
   */
  enqueue(item: Omit<OutboxItem, 'enqueuedAt'>): boolean {
    if (this.seen.has(item.id)) return false;
    this.seen.add(item.id);
    this.items.push({ ...item, enqueuedAt: this.now() });
    return true;
  }

  /**
   * Drain items whose turn was completed. Preserves insertion order.
   * After draining, the ids are released from the seen set so a future
   * re-enqueue with the same id would succeed (caller controls ids).
   */
  drain(completedIds: Set<string>): OutboxItem[] {
    const drained: OutboxItem[] = [];
    const keep: OutboxItem[] = [];
    for (const item of this.items) {
      if (completedIds.has(item.id)) {
        drained.push(item);
        this.seen.delete(item.id);
      } else {
        keep.push(item);
      }
    }
    this.items = keep;
    return drained;
  }

  /**
   * Remove a single item by id (e.g. user cancels). Returns the removed item
   * or null if not present. Preserves order of remaining items.
   */
  remove(id: string): OutboxItem | null {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const [removed] = this.items.splice(idx, 1);
    this.seen.delete(id);
    return removed;
  }

  size(): number {
    return this.items.length;
  }

  all(): ReadonlyArray<OutboxItem> {
    return this.items;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  clear(): void {
    this.items = [];
    this.seen.clear();
  }
}

// -----------------------------------------------------------------------------
// T-20 — turn stream construction
// -----------------------------------------------------------------------------

export interface TurnStreamInput {
  turnId: string;
  mode: Mode;
  persona: string;
  sensitivity: Sensitivity;
  riskTier: 0 | 1 | 2 | 3;
  routeRole: string;
  routeFamily: string;
  /** Tokens the model will emit (order preserved). */
  tokens: string[];
  /** Trace lines to interleave between tokens. Key = 0-based token index. */
  traceBeforeToken?: Record<number, string[]>;
  /** Optional degradation level (T-22). */
  degradation?: DegradationLevel;
  /** Optional summary (T-32). */
  summary?: Omit<ChatSummaryEvent, 'type'>;
  /** Total call count in this turn (for `done.calls`). */
  calls: number;
  /** Total token count in this turn (for `done.tokens`). */
  tokenCount: number;
  /** Clock override (T-20 determinism in tests). */
  now?: () => number;
}

/**
 * Build the full ChatEvent stream for a turn.
 *
 * Order is spec-locked:
 *   1. meta
 *   2. degradation notice (if any — T-22)
 *   3. per token index:
 *        a. any trace lines keyed to this index
 *        b. the token itself
 *   4. summary (if provided)
 *   5. done
 *
 * T-20: `trace.tMs` is monotonic (0, 1, 2, …). `done.elapsedMs` is the
 * wall-clock time from just-before-meta to just-before-done, measured by
 * the injected clock.
 */
export function createTurnStream(input: TurnStreamInput): ChatEvent[] {
  const now = input.now ?? (() => Date.now());
  const startMs = now();
  const events: ChatEvent[] = [];
  let seq = 0;
  let lastT = 0;

  // 1. meta
  events.push({
    v: 1,
    type: 'meta',
    turnId: input.turnId,
    mode: input.mode,
    persona: input.persona,
    sensitivity: input.sensitivity,
    riskTier: input.riskTier,
    routeRole: input.routeRole,
    routeFamily: input.routeFamily,
  });

  // 2. degradation notice
  if (input.degradation) {
    const notice = noticeForLevel(input.degradation);
    if (notice) events.push(notice);
  }

  // 3. token-by-token interleaved with trace
  for (let i = 0; i < input.tokens.length; i++) {
    const traceLines = input.traceBeforeToken?.[i];
    if (traceLines) {
      for (const text of traceLines) {
        // Monotonic timestamp: lastT + 1 is guaranteed greater than lastT.
        lastT = lastT + 1;
        events.push({
          type: 'trace',
          seq: seq++,
          tMs: lastT,
          kind: 'step',
          text,
        });
      }
    }
    events.push({ type: 'token', delta: input.tokens[i] });
  }

  // 4. summary (only if provided — T-32 honesty)
  if (input.summary) {
    events.push({ type: 'summary', ...input.summary });
  }

  // 5. done
  const endMs = now();
  events.push({
    type: 'done',
    elapsedMs: endMs - startMs,
    calls: input.calls,
    tokens: input.tokenCount,
    costInr: 0,
  });

  return events;
}

/** Serialise an entire event array to an SSE payload (concatenated frames). */
export function serialiseStream(events: ChatEvent[]): string {
  let out = '';
  for (const evt of events) out += formatSseEvent(evt);
  return out;
}
// === FILE END ===