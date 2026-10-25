// === FILE START ===
// packages/truth-score/src/cache.ts
// PRD 8.3 step 10 · 13.8 · FR-WF-04 · FR-TRUTH-14 · T-28 (partial).
//
// The verdict cache. Normalised claim hash → verified ClaimVerdict, with
// per-volatility TTL from PRD 13.8:
//
//   stable → 30 days
//   slow   → 7 days
//   fast   → 24 hours
//
// On lookup:
//   · Fresh hit (age < TTL)  → return as-is
//   · Stale hit (age ≥ TTL)  → return with stale:true so caller re-checks
//   · Miss / invalidated     → return null
//
// On put:
//   · Overwrites existing entry (newest verdict wins)
//   · Evicts oldest when over capacity (LRU by insertion order)
//
// Caches the FULL ClaimVerdict including evidence[], so the Fact drawer can
// render every quote without re-fetching. Bounded at 5,000 entries by default.
//
// "Prove it" (FR-TRUTH-14) invalidates one claim: cache.invalidate(text).

import type { ClaimVerdict } from './verdict.js';
import type { ClaimVolatility } from './types.js';
import { normalizeForMatch } from './quote-span.js';

// -----------------------------------------------------------------------------
// Constants (PRD 13.8)
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export const CACHE_TTL_MS: Record<ClaimVolatility, number> = {
  stable: 30 * DAY_MS, // 30 days
  slow: 7 * DAY_MS,    // 7 days
  fast: 1 * DAY_MS,    // 24 hours
} as const;

export const DEFAULT_MAX_CACHE_ENTRIES = 5_000;

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface CacheLookup {
  verdict: ClaimVerdict;
  cachedAt: number;
  ageMs: number;
  ttlMs: number;
  stale: boolean;
}

export interface VerdictCacheOptions {
  /** Max entries before LRU eviction. Default 5,000. */
  maxEntries?: number;
  /** Injectable clock. Defaults to Date.now. */
  now?: () => number;
  /** Override TTLs (for tests). */
  ttlMs?: Partial<Record<ClaimVolatility, number>>;
}

interface CacheEntry {
  key: string;
  verdict: ClaimVerdict;
  cachedAt: number;
  volatility: ClaimVolatility;
  ttlMs: number;
}

// -----------------------------------------------------------------------------
// Hash
// -----------------------------------------------------------------------------

/**
 * Normalised claim hash. Uses the same normalization as the quote-span check
 * (whitespace collapse, unicode folding, case fold) so "The Eiffel Tower"
 * and "the  eiffel tower" produce the same cache key.
 */
export function claimHash(text: string): string {
  return normalizeForMatch(text);
}

// -----------------------------------------------------------------------------
// VerdictCache
// -----------------------------------------------------------------------------

export class VerdictCache {
  private entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly ttls: Record<ClaimVolatility, number>;

  constructor(opts: VerdictCacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
    this.now = opts.now ?? (() => Date.now());
    this.ttls = {
      stable: opts.ttlMs?.stable ?? CACHE_TTL_MS.stable,
      slow: opts.ttlMs?.slow ?? CACHE_TTL_MS.slow,
      fast: opts.ttlMs?.fast ?? CACHE_TTL_MS.fast,
    };
  }

  /**
   * Look up a cached verdict by claim text. Returns the entry with the current
   * age and a stale flag, or null on miss / volatility change.
   */
  get(
    text: string,
    volatility: ClaimVolatility,
    at?: number,
  ): CacheLookup | null {
    const key = claimHash(text);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.volatility !== volatility) {
      // Same text, different volatility class → different TTL → treat as miss.
      // The caller should re-verify under the new volatility assumptions.
      return null;
    }
    const when = at ?? this.now();
    const ageMs = when - entry.cachedAt;
    return {
      verdict: entry.verdict,
      cachedAt: entry.cachedAt,
      ageMs,
      ttlMs: entry.ttlMs,
      stale: ageMs >= entry.ttlMs,
    };
  }

  /**
   * Cache a verdict. Overwrites any existing entry for the same hash. Evicts
   * the oldest entry when over capacity.
   */
  put(
    text: string,
    volatility: ClaimVolatility,
    verdict: ClaimVerdict,
    at?: number,
  ): void {
    const key = claimHash(text);
    const when = at ?? this.now();
    const ttlMs = this.ttls[volatility];

    // If the entry exists, remove it first so insertion order moves it to
    // the end (LRU semantics).
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      key,
      verdict,
      cachedAt: when,
      volatility,
      ttlMs,
    });

    // LRU eviction (oldest at the front of the Map)
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  /**
   * Invalidate a specific claim (used by "Prove it" / "Re-verify now",
   * FR-TRUTH-14). Returns true if an entry existed.
   */
  invalidate(text: string): boolean {
    return this.entries.delete(claimHash(text));
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.clear();
  }

  /** Current entry count. */
  size(): number {
    return this.entries.size;
  }

  /** Max entries allowed. */
  capacity(): number {
    return this.maxEntries;
  }

  /**
   * Remove all stale entries. Useful for a background sweep after long idle.
   * Returns the number of evicted entries.
   */
  pruneStale(at?: number): number {
    const when = at ?? this.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (when - entry.cachedAt >= entry.ttlMs) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
// === FILE END ===