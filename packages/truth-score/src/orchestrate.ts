// === FILE START ===
// packages/truth-score/src/orchestrate.ts
// PRD 8.3 · FR-TRUTH-01 to FR-TRUTH-24 · T-06 · T-33.
// Section 81: optional VerdictCache integration (backwards-compatible).
//
// The full verification stack, wired into one call:
//
//   verifyClaim(claim, sources, judge, broker, cache?)
//     ↓ if cache && checkable && checked:
//       cache.get(text, volatility) → fresh hit? return cached with fromCache:true
//                                    → stale hit? record in trace, re-verify
//                                    → miss? proceed
//     ↓ for each source:
//       broker.reserveWithFallback(...) — Section 77 quota enforcement
//       if ok → judge(source) → quote-span check → collect evidence
//       if denied → record attempt (retryAfterMs)
//     ↓ if ZERO sources were checked → defer
//       status = RECALL_ONLY, deferred: true, deferredUntil = now + minRetry
//       (never cached — deferred claims must be retried)
//     ↓ else → run the full pipeline (Sections 74-76)
//       score, glyph, concordance, wouldStrengthen, evidence
//       then cache.put(text, volatility, verdict) if score !== null
//
// Terminal cases (no broker involvement):
//   · checkable:false       → NOT_SCORED          (never cached)
//   · checked:false         → RECALL_ONLY         (never cached)
//   · sources=[]            → UNVERIFIED (cap 59) (cached)

import {
  VerificationBroker,
  type PoolId,
  type DenialReason,
  type ReservationToken,
} from './broker.js';
import {
  runPipeline,
  type ClaimInput,
  type FetchedSource,
  type JudgeResponse,
  type JudgeCall,
} from './pipeline.js';
import type { ClaimVerdict } from './verdict.js';
import type { VerdictCache } from './cache.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface JudgeInput {
  claim: ClaimInput;
  source: FetchedSource;
}
export type JudgeFn = (input: JudgeInput) => JudgeResponse;

export interface ReserveAttempt {
  pool: PoolId;
  reason: DenialReason;
  retryAfterMs: number | null;
}

export interface FailedSource {
  sourceId: string;
  attempts: ReserveAttempt[];
}

export type DeferReason = 'quota' | 'all_pools_dry';

export interface VerifyClaimOptions {
  claim: ClaimInput;
  sources: FetchedSource[];
  judge: JudgeFn;
  broker: VerificationBroker;
  poolChain?: PoolId[];
  now?: () => number;
  /** NEW (Section 81): optional verdict cache. */
  cache?: VerdictCache;
}

export interface VerifyClaimResult {
  verdict: ClaimVerdict;
  trace: string[];
  deferred: boolean;
  deferredUntil: string | null;
  deferredReason: DeferReason | null;
  failedSources: FailedSource[];
  checkedSourceIds: string[];
  /** NEW (Section 81): true when the verdict came from cache. */
  fromCache?: boolean;
  /** NEW (Section 81): cache timestamp when fromCache is true. */
  cachedAt?: number | null;
}

// -----------------------------------------------------------------------------
// Default pool chain
// -----------------------------------------------------------------------------

const DEFAULT_CHAIN: PoolId[] = [
  'wikipedia',
  'arxiv',
  'gemini-grounding',
  'tavily',
  'exa',
  'jina',
];

// -----------------------------------------------------------------------------
// Cache helper
// -----------------------------------------------------------------------------

function cacheVerdict(
  opts: VerifyClaimOptions,
  verdict: ClaimVerdict,
  trace: string[],
): void {
  if (!opts.cache) return;
  if (!opts.claim.checkable) return;
  if (!opts.claim.checked) return;
  if (verdict.score === null) return;
  opts.cache.put(opts.claim.text, opts.claim.volatility, verdict);
  trace.push(`[verify] cached claim=${opts.claim.claimId}`);
}

// -----------------------------------------------------------------------------
// The orchestrator
// -----------------------------------------------------------------------------

export function verifyClaim(opts: VerifyClaimOptions): VerifyClaimResult {
  const now = opts.now ?? (() => Date.now());
  const poolChain = opts.poolChain ?? DEFAULT_CHAIN;
  const trace: string[] = [];

  trace.push(
    `[verify] claim=${opts.claim.claimId} sources=${opts.sources.length} ` +
      `checkable=${opts.claim.checkable} checked=${opts.claim.checked} ` +
      `chain=[${poolChain.join(',')}]`,
  );

  // NEW (Section 81): cache lookup before any terminal logic.
  // Only for genuinely checkable+checked claims (NOT_SCORED and
  // RECALL_ONLY-from-checked-false are metadata-deterministic; caching
  // them would be pointless and the caller can re-derive them).
  if (opts.cache && opts.claim.checkable && opts.claim.checked) {
    const hit = opts.cache.get(opts.claim.text, opts.claim.volatility);
    if (hit && !hit.stale) {
      trace.push(
        `[verify] cache-hit claim=${opts.claim.claimId} ` +
          `ageMs=${hit.ageMs} ttlMs=${hit.ttlMs} cachedAt=${hit.cachedAt}`,
      );
      return {
        verdict: hit.verdict,
        trace,
        deferred: false,
        deferredUntil: null,
        deferredReason: null,
        failedSources: [],
        checkedSourceIds: [],
        fromCache: true,
        cachedAt: hit.cachedAt,
      };
    }
    if (hit && hit.stale) {
      trace.push(
        `[verify] cache-stale claim=${opts.claim.claimId} ` +
          `ageMs=${hit.ageMs} ttlMs=${hit.ttlMs} (re-checking)`,
      );
    }
  }

  // Terminal 1: not checkable → NOT_SCORED, no broker needed, never cached.
  if (!opts.claim.checkable) {
    trace.push('[verify] terminal: NOT_SCORED');
    const result = runPipeline(opts.claim, [], []);
    return {
      verdict: result.verdict,
      trace: [...trace, ...result.trace],
      deferred: false,
      deferredUntil: null,
      deferredReason: null,
      failedSources: [],
      checkedSourceIds: [],
      fromCache: false,
      cachedAt: null,
    };
  }

  // Terminal 2: explicitly not checked → RECALL_ONLY, no broker needed, never cached.
  if (!opts.claim.checked) {
    trace.push('[verify] terminal: RECALL_ONLY (checked=false)');
    const result = runPipeline(opts.claim, [], []);
    return {
      verdict: result.verdict,
      trace: [...trace, ...result.trace],
      deferred: false,
      deferredUntil: null,
      deferredReason: null,
      failedSources: [],
      checkedSourceIds: [],
      fromCache: false,
      cachedAt: null,
    };
  }

  // Terminal 3 (Section 78): no sources to check → UNVERIFIED.
  // Cached (Section 81) because UNVERIFIED has a real score (≤ 59) and is
  // deterministic for the same claim text.
  if (opts.sources.length === 0) {
    trace.push('[verify] terminal: UNVERIFIED (no sources to check)');
    const result = runPipeline(opts.claim, [], []);
    cacheVerdict(opts, result.verdict, trace);
    return {
      verdict: result.verdict,
      trace: [...trace, ...result.trace],
      deferred: false,
      deferredUntil: null,
      deferredReason: null,
      failedSources: [],
      checkedSourceIds: [],
      fromCache: false,
      cachedAt: null,
    };
  }

  // Walk each source: reserve → judge → collect.
  const judgeCalls: JudgeCall[] = [];
  const checkedSourceIds: string[] = [];
  const failedSources: FailedSource[] = [];
  const checkedSourceObjects: FetchedSource[] = [];
  const retryAfterList: number[] = [];

  for (const source of opts.sources) {
    const reservation = reserveAcrossChain(
      opts.broker,
      poolChain,
      source.id,
      opts.claim.claimId,
    );

    if (!reservation.ok) {
      trace.push(
        `[verify] reserve-denied claim=${opts.claim.claimId} source=${source.id} ` +
          `attempts=${reservation.attempts.map((a) => `${a.pool}:${a.reason}`).join(',')}`,
      );
      for (const attempt of reservation.attempts) {
        if (attempt.retryAfterMs !== null) retryAfterList.push(attempt.retryAfterMs);
      }
      failedSources.push({
        sourceId: source.id,
        attempts: reservation.attempts,
      });
      continue;
    }

    trace.push(
      `[verify] reserved claim=${opts.claim.claimId} source=${source.id} ` +
        `pool=${reservation.token.pool}`,
    );

    let response: JudgeResponse;
    try {
      response = opts.judge({ claim: opts.claim, source });
    } catch (err) {
      opts.broker.release(reservation.token);
      const msg = err instanceof Error ? err.message : String(err);
      trace.push(`[verify] judge-error source=${source.id} err=${msg}`);
      failedSources.push({
        sourceId: source.id,
        attempts: [
          { pool: reservation.token.pool, reason: 'unknown_pool', retryAfterMs: null },
        ],
      });
      continue;
    }

    opts.broker.commit(reservation.token, 1);

    judgeCalls.push({ sourceId: source.id, response });
    checkedSourceIds.push(source.id);
    checkedSourceObjects.push(source);
  }

  // All sources failed → defer as RECALL_ONLY, never cached.
  if (judgeCalls.length === 0) {
    const canRetry = retryAfterList.length > 0;
    const minRetry = canRetry ? Math.min(...retryAfterList) : 0;
    const deferredClaim: ClaimInput = { ...opts.claim, checked: false };
    trace.push(
      `[verify] DEFERRED claim=${opts.claim.claimId} ` +
        `reason=${canRetry ? 'quota' : 'all_pools_dry'} retryAfterMs=${minRetry}`,
    );
    const result = runPipeline(deferredClaim, [], []);
    return {
      verdict: result.verdict,
      trace: [...trace, ...result.trace],
      deferred: true,
      deferredUntil: canRetry ? new Date(now() + minRetry).toISOString() : null,
      deferredReason: canRetry ? 'quota' : 'all_pools_dry',
      failedSources,
      checkedSourceIds: [],
      fromCache: false,
      cachedAt: null,
    };
  }

  // Some evidence was collected — score normally and cache if it scored.
  const pipeline = runPipeline(opts.claim, checkedSourceObjects, judgeCalls);
  cacheVerdict(opts, pipeline.verdict, trace);
  return {
    verdict: pipeline.verdict,
    trace: [...trace, ...pipeline.trace],
    deferred: false,
    deferredUntil: null,
    deferredReason: null,
    failedSources,
    checkedSourceIds,
    fromCache: false,
    cachedAt: null,
  };
}

// -----------------------------------------------------------------------------
// Reserve helper
// -----------------------------------------------------------------------------

type ReserveResult =
  | { ok: true; token: ReservationToken }
  | { ok: false; attempts: ReserveAttempt[] };

function reserveAcrossChain(
  broker: VerificationBroker,
  chain: PoolId[],
  sourceId: string,
  claimId: string,
): ReserveResult {
  const attempts: ReserveAttempt[] = [];
  for (const pool of chain) {
    void sourceId;
    const outcome = broker.reserve(pool, 1, 'verify', claimId);
    if (outcome.ok) return outcome;
    attempts.push({
      pool,
      reason: outcome.reason,
      retryAfterMs: outcome.retryAfterMs,
    });
  }
  return { ok: false, attempts };
}
// === FILE END ===