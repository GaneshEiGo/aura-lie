// === FILE START ===
// packages/truth-score/src/ledger.ts
// PRD FR-TRUTH-23 · 8.11 · F-257.
//
// The Claim Ledger. Every claim ever made is searchable with its current
// status and its full score history.
//
// · `addClaim(verdict, {turnId})` — one insert per new claim. Throws on
//   duplicate claimId so a stale claimId in the caller's code is caught
//   immediately.
// · `recordCorrection(claimId, newVerdict, reason)` — appends to the
//   entry's history, updates current status/score. The old status/score
//   remain visible in history[].
// · `search(opts)` — text/status/date filters, cursor pagination.
//   Newest-first by default. Cursor is stable across inserts (encodes the
//   last row's (createdAt, claimId) pair).
// · `getAll()` — insertion-order read-only view for the ledger table UI.
//
// Storage is the caller's responsibility (IndexedDB in Aura-lie). This
// module is the pure in-memory index.

import type { ClaimVerdict } from './verdict.js';
import type { ClaimStatus } from './types.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type LedgerHistoryReason = 'initial' | 're-verified' | 'corrected';

export interface LedgerHistoryEntry {
  at: number;
  reason: LedgerHistoryReason;
  previousStatus: ClaimStatus | null;
  previousScore: number | null;
  newStatus: ClaimStatus;
  newScore: number | null;
}

export interface LedgerEntry {
  claimId: string;
  claimText: string;
  status: ClaimStatus;
  score: number | null;
  glyph: string;
  turnId: string;
  createdAt: number;
  caps: string[];
  evidenceCount: number;
  concordance: { supports: number; contradicts: number; neutral: number };
  evidenceStrength: string;
  history: LedgerHistoryEntry[];
}

export interface SearchOpts {
  /** Case-insensitive substring on claimText. */
  text?: string;
  /** Exact match on ClaimStatus. */
  status?: ClaimStatus;
  /** createdAt >= fromDate (ms since epoch). */
  fromDate?: number;
  /** createdAt <= toDate (ms since epoch). */
  toDate?: number;
  /** Opaque cursor from a previous search. */
  cursor?: string;
  /** Default 20, max 100. */
  limit?: number;
}

export interface SearchResult {
  items: LedgerEntry[];
  nextCursor: string | null;
  totalCount: number;
}

export interface AddClaimOpts {
  turnId: string;
}

// -----------------------------------------------------------------------------
// Cursor encoding
// -----------------------------------------------------------------------------

function encodeCursor(createdAt: number, claimId: string): string {
  // Base64 of "createdAt:claimId"
  const raw = `${createdAt}:${claimId}`;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'utf8').toString('base64');
  }
  // Fallback for browser (test env is Node, but defensive)
  return btoa(raw);
}

function decodeCursor(cursor: string): { createdAt: number; claimId: string } {
  const raw =
    typeof Buffer !== 'undefined'
      ? Buffer.from(cursor, 'base64').toString('utf8')
      : atob(cursor);
  const idx = raw.indexOf(':');
  if (idx === -1) throw new Error(`Invalid cursor: ${cursor}`);
  const createdAt = Number(raw.slice(0, idx));
  const claimId = raw.slice(idx + 1);
  if (!Number.isFinite(createdAt)) throw new Error(`Invalid cursor: ${cursor}`);
  return { createdAt, claimId };
}

// -----------------------------------------------------------------------------
// ClaimLedger
// -----------------------------------------------------------------------------

export interface ClaimLedgerOptions {
  /** Injectable clock. Defaults to Date.now. */
  now?: () => number;
}

export class ClaimLedger {
  private entries = new Map<string, LedgerEntry>();
  private readonly now: () => number;

  constructor(opts: ClaimLedgerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Add a new claim. Throws if the claimId already exists — call
   * recordCorrection() instead for updates.
   */
  addClaim(verdict: ClaimVerdict, opts: AddClaimOpts): void {
    if (this.entries.has(verdict.claimId)) {
      throw new Error(
        `ClaimLedger.addClaim: claim ${verdict.claimId} already exists (use recordCorrection)`,
      );
    }
    const now = this.now();
    const entry: LedgerEntry = {
      claimId: verdict.claimId,
      claimText: verdict.claimText,
      status: verdict.status,
      score: verdict.score,
      glyph: verdict.glyph,
      turnId: opts.turnId,
      createdAt: now,
      caps: [...verdict.caps],
      evidenceCount: verdict.evidence.length,
      concordance: { ...verdict.concordance },
      evidenceStrength: verdict.evidenceStrength,
      history: [
        {
          at: now,
          reason: 'initial',
          previousStatus: null,
          previousScore: null,
          newStatus: verdict.status,
          newScore: verdict.score,
        },
      ],
    };
    this.entries.set(verdict.claimId, entry);
  }

  /**
   * Record a correction. Appends a history entry and updates current
   * status/score/glyph/caps/evidence. The previous values are preserved
   * inside history[].
   */
  recordCorrection(
    claimId: string,
    newVerdict: ClaimVerdict,
    reason: LedgerHistoryReason = 're-verified',
  ): void {
    const entry = this.entries.get(claimId);
    if (!entry) {
      throw new Error(
        `ClaimLedger.recordCorrection: claim ${claimId} not found`,
      );
    }
    const now = this.now();
    entry.history.push({
      at: now,
      reason,
      previousStatus: entry.status,
      previousScore: entry.score,
      newStatus: newVerdict.status,
      newScore: newVerdict.score,
    });
    entry.status = newVerdict.status;
    entry.score = newVerdict.score;
    entry.glyph = newVerdict.glyph;
    entry.caps = [...newVerdict.caps];
    entry.evidenceCount = newVerdict.evidence.length;
    entry.concordance = { ...newVerdict.concordance };
    entry.evidenceStrength = newVerdict.evidenceStrength;
  }

  findByClaimId(claimId: string): LedgerEntry | null {
    return this.entries.get(claimId) ?? null;
  }

  size(): number {
    return this.entries.size;
  }

  /** Insertion-order view. Read-only. */
  getAll(): ReadonlyArray<LedgerEntry> {
    return Array.from(this.entries.values());
  }

  /**
   * Search with filters. Newest-first by (createdAt DESC, claimId ASC).
   * Cursor is stable across inserts with newer createdAt.
   */
  search(opts: SearchOpts = {}): SearchResult {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const all = Array.from(this.entries.values());

    // Filter (AND)
    const filtered = all.filter((e) => {
      if (opts.text !== undefined && opts.text.length > 0) {
        if (!e.claimText.toLowerCase().includes(opts.text.toLowerCase())) {
          return false;
        }
      }
      if (opts.status !== undefined && e.status !== opts.status) {
        return false;
      }
      if (opts.fromDate !== undefined && e.createdAt < opts.fromDate) {
        return false;
      }
      if (opts.toDate !== undefined && e.createdAt > opts.toDate) {
        return false;
      }
      return true;
    });

    const totalCount = filtered.length;

    // Sort newest-first, tiebreaker claimId ASC
    filtered.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
    });

    // Apply cursor
    let startIdx = 0;
    if (opts.cursor) {
      const { createdAt, claimId } = decodeCursor(opts.cursor);
      for (let i = 0; i < filtered.length; i++) {
        const e = filtered[i];
        const cmp =
          e.createdAt < createdAt
            ? 1
            : e.createdAt > createdAt
              ? -1
              : e.claimId > claimId
                ? 1
                : e.claimId < claimId
                  ? -1
                  : 0;
        if (cmp > 0) {
          // e comes strictly after the cursor position
          startIdx = i;
          break;
        }
        startIdx = i + 1;
      }
    }

    const remaining = filtered.slice(startIdx);
    const pageItems = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? encodeCursor(
            pageItems[pageItems.length - 1].createdAt,
            pageItems[pageItems.length - 1].claimId,
          )
        : null;

    return { items: pageItems, nextCursor, totalCount };
  }
}
// === FILE END ===