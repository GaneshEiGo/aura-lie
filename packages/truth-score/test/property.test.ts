// === FILE START ===
// packages/truth-score/test/property.test.ts
// T-33 · PRD 8.7 · property tests.
//
// 10,000 random ScoreClaimInput, verify:
//   · score is always in [0, 100]
//   · no cap is ever exceeded
//   · all present factors are in [0, 100]
//   · response-level weakest-critical rule holds

import { describe, it, expect } from 'vitest';
import { scoreClaim } from '../src/score.js';
import { scoreResponse } from '../src/response.js';
import type {
  ScoreClaimInput,
  ScoredClaim,
  SourceTier,
  ClaimVolatility,
} from '../src/types.js';

// Deterministic PRNG so a failure is reproducible.
class PRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed % 0x80000000;
  }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  range(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  bool(pTrue: number): boolean {
    return this.next() < pTrue;
  }
}

const TIERS: readonly SourceTier[] = [
  'primary',
  'peerReviewed',
  'reputable',
  'interested',
  'forum',
  'unknown',
];
const VOLATILITIES: readonly ClaimVolatility[] = ['stable', 'slow', 'fast'];

function randomClaim(rng: PRNG): ScoreClaimInput {
  const numSources = rng.int(0, 5);
  const sources = Array.from({ length: numSources }, () => ({
    tier: rng.pick(TIERS),
    ageDays: rng.range(0, 365 * 5),
    independenceKey: `k${rng.int(1, 3)}`, // intentional overlaps to test dedup
  }));

  return {
    checkable: rng.bool(0.9),
    checked: rng.bool(0.85),
    sources,
    entailment: rng.bool(0.7) ? rng.range(0, 100) : null,
    agreement: rng.bool(0.6) ? rng.range(0, 100) : null,
    consistency: rng.bool(0.4) ? rng.range(0, 100) : null,
    quoteVerified: rng.bool(0.85) ? true : rng.bool(0.5) ? false : null,
    contradiction: rng.bool(0.2) ? 'strong' : rng.bool(0.3) ? 'weak' : null,
    volatility: rng.pick(VOLATILITIES),
    halfLifeDays: rng.bool(0.3) ? rng.range(1, 365) : undefined,
  };
}

// =============================================================================
// T-33 property gates
// =============================================================================

describe('T-33 — 10,000 random claims', () => {
  it('score is always in [0, 100] or null', () => {
    const rng = new PRNG(42);
    let tested = 0;
    for (let i = 0; i < 10000; i++) {
      const result = scoreClaim(randomClaim(rng));
      tested += 1;
      if (result.score === null) continue;
      if (result.score < 0 || result.score > 100) {
        throw new Error(`Iteration ${i}: score ${result.score} out of [0,100]`);
      }
    }
    expect(tested).toBe(10000);
  });

  it('no cap is ever exceeded', () => {
    const rng = new PRNG(1234);
    for (let i = 0; i < 10000; i++) {
      const result = scoreClaim(randomClaim(rng));
      if (result.score === null) continue;
      if (result.caps.includes('quote_failed') && result.score > 40) {
        throw new Error(`Iteration ${i}: quote_failed cap violated (${result.score})`);
      }
      if (result.caps.includes('no_source') && result.score > 59) {
        throw new Error(`Iteration ${i}: no_source cap violated (${result.score})`);
      }
      if (result.caps.includes('interested_only') && result.score > 69) {
        throw new Error(`Iteration ${i}: interested_only cap violated (${result.score})`);
      }
      if (result.caps.includes('strong_contradiction') && result.score > 69) {
        throw new Error(`Iteration ${i}: strong_contradiction cap violated (${result.score})`);
      }
      if (result.caps.includes('stale') && result.score > 69) {
        throw new Error(`Iteration ${i}: stale cap violated (${result.score})`);
      }
    }
  });

  it('every present factor is in [0, 100]', () => {
    const rng = new PRNG(9999);
    for (let i = 0; i < 10000; i++) {
      const result = scoreClaim(randomClaim(rng));
      for (const [name, value] of Object.entries(result.factors)) {
        if (value === undefined) continue;
        if (value < 0 || value > 100) {
          throw new Error(`Iteration ${i}: factor ${name} = ${value} out of [0,100]`);
        }
      }
    }
  });

  it('CONFLICTED status always applies the strong_contradiction cap', () => {
    const rng = new PRNG(7777);
    for (let i = 0; i < 10000; i++) {
      const result = scoreClaim(randomClaim(rng));
      if (result.status === 'CONFLICTED' && result.score !== null) {
        if (result.score > 69) {
          throw new Error(`Iteration ${i}: CONFLICTED score ${result.score} exceeds 69`);
        }
      }
    }
  });

  it('NOT_SCORED and RECALL_ONLY always have score === null', () => {
    const rng = new PRNG(555);
    for (let i = 0; i < 10000; i++) {
      const result = scoreClaim(randomClaim(rng));
      if (result.status === 'NOT_SCORED' || result.status === 'RECALL_ONLY') {
        if (result.score !== null) {
          throw new Error(`Iteration ${i}: ${result.status} with non-null score`);
        }
      }
    }
  });
});

// =============================================================================
// Response-level property
// =============================================================================

describe('T-33 — response-level weakest-critical rule', () => {
  it('overall never exceeds lowest_critical + 15', () => {
    const rng = new PRNG(2026);
    for (let i = 0; i < 1000; i++) {
      const numClaims = rng.int(1, 5);
      const claims: ScoredClaim[] = Array.from({ length: numClaims }, () => ({
        status: 'SUPPORTED' as const,
        score: rng.range(0, 100),
        importance: rng.bool(0.5) ? 1.0 : 0.5,
      }));
      const summary = scoreResponse(claims);
      if (summary.overall === null) continue;

      const totalW = claims.reduce((s, c) => s + c.importance, 0);
      const weightedSum = claims.reduce(
        (s, c) => s + c.importance * (c.score as number),
        0,
      );
      const mean = totalW > 0 ? weightedSum / totalW : 0;
      const criticals = claims
        .filter((c) => c.importance >= 0.7)
        .map((c) => c.score as number);
      const lowest = criticals.length > 0 ? Math.min(...criticals) : Infinity;
      const bound = lowest === Infinity ? Infinity : lowest + 15;

      if (summary.overall > Math.round(bound)) {
        throw new Error(
          `Iteration ${i}: overall ${summary.overall} > bound ${Math.round(bound)}`,
        );
      }
    }
  });

  it('coverage is always in [0, 1]', () => {
    const rng = new PRNG(8888);
    for (let i = 0; i < 1000; i++) {
      const numClaims = rng.int(0, 6);
      const statuses = ['VERIFIED', 'SUPPORTED', 'MIXED', 'WEAK', 'NOT_SCORED', 'RECALL_ONLY'] as const;
      const claims: ScoredClaim[] = Array.from({ length: numClaims }, () => {
        const st = rng.pick(statuses);
        return {
          status: st,
          score: st === 'NOT_SCORED' || st === 'RECALL_ONLY' ? null : rng.range(0, 100),
          importance: rng.bool(0.5) ? 1.0 : 0.5,
        };
      });
      const summary = scoreResponse(claims);
      if (summary.coverage < 0 || summary.coverage > 1) {
        throw new Error(`Iteration ${i}: coverage ${summary.coverage} out of [0,1]`);
      }
    }
  });
});
// === FILE END ===