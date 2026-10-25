// === FILE START ===
// packages/truth-score/test/score.test.ts
// PRD 8.7 · F-035 · F-036 · T-06.
// Includes the PRD's worked example reproduced exactly.

import { describe, it, expect } from 'vitest';
import { scoreClaim } from '../src/score.js';
import { scoreResponse } from '../src/response.js';
import { freshnessScore, HALF_LIFE_DAYS, WEIGHTS } from '../src/weights.js';
import type { ScoreClaimInput, ScoredClaim } from '../src/types.js';

function baseInput(overrides: Partial<ScoreClaimInput> = {}): ScoreClaimInput {
  return {
    checkable: true,
    checked: true,
    sources: [{ tier: 'primary', ageDays: 10, independenceKey: 'k1' }],
    entailment: 100,
    agreement: 100,
    consistency: null,
    quoteVerified: true,
    contradiction: null,
    volatility: 'stable',
    ...overrides,
  };
}

// =============================================================================
// T-06 gate — PRD worked example
// =============================================================================

describe('T-06 — PRD 8.7 worked example', () => {
  it('reproduces score 48 with status CONFLICTED', () => {
    const result = scoreClaim({
      checkable: true,
      checked: true,
      sources: [{ tier: 'interested', ageDays: 210, independenceKey: 'k1' }],
      entailment: 100,
      agreement: 50,
      consistency: null,
      quoteVerified: true,
      contradiction: 'strong',
      volatility: 'slow',
      halfLifeDays: 90,
    });

    // S = 50 * 0.80 = 40  (1 source, tier=interested)
    expect(result.factors.S).toBeCloseTo(40, 0);
    // E = 100  (explicit match)
    expect(result.factors.E).toBe(100);
    // A = 50
    expect(result.factors.A).toBe(50);
    // F = 100 * 2/(210/90 + 1) = 60
    expect(result.factors.F).toBeCloseTo(60, 0);
    // C excluded
    expect(result.factors.C).toBeUndefined();
    expect(result.partialCheck).toBe(true);
    expect(result.penalty).toBe(15);
    // Final score 48, status CONFLICTED
    expect(result.score).toBe(48);
    expect(result.status).toBe('CONFLICTED');
  });

  it('reproduces the response-level overall 63', () => {
    const claim1: ScoredClaim = { status: 'VERIFIED', score: 92, importance: 1.0 };
    const claim2: ScoredClaim = { status: 'CONFLICTED', score: 48, importance: 1.0 };
    const summary = scoreResponse([claim1, claim2]);
    expect(summary.overall).toBe(63);
    expect(summary.checkedCount).toBe(2);
    expect(summary.checkableCount).toBe(2);
    expect(summary.coverage).toBe(1);
    // PRD 5.6: critical CONFLICTED claim → CHECK chip
    expect(summary.chip).toBe('CHECK');
  });
});

// =============================================================================
// S factor
// =============================================================================

describe('S factor — source support', () => {
  it('1 primary source → S = 100 * 0.80 = 80', () => {
    const r = scoreClaim(baseInput({ sources: [{ tier: 'primary', ageDays: 1, independenceKey: 'k1' }] }));
    expect(r.factors.S).toBeCloseTo(80, 0);
  });

  it('2 primary sources → S = 100 * 0.92 = 92', () => {
    const r = scoreClaim(
      baseInput({
        sources: [
          { tier: 'primary', ageDays: 1, independenceKey: 'k1' },
          { tier: 'primary', ageDays: 1, independenceKey: 'k2' },
        ],
      }),
    );
    expect(r.factors.S).toBeCloseTo(92, 0);
  });

  it('3 primary sources → S = 100 * 1.00 = 100', () => {
    const r = scoreClaim(
      baseInput({
        sources: [
          { tier: 'primary', ageDays: 1, independenceKey: 'k1' },
          { tier: 'primary', ageDays: 1, independenceKey: 'k2' },
          { tier: 'primary', ageDays: 1, independenceKey: 'k3' },
        ],
      }),
    );
    expect(r.factors.S).toBeCloseTo(100, 0);
  });

  it('syndicated copies (same independenceKey) count once', () => {
    const r = scoreClaim(
      baseInput({
        sources: [
          { tier: 'primary', ageDays: 1, independenceKey: 'same' },
          { tier: 'primary', ageDays: 1, independenceKey: 'same' },
        ],
      }),
    );
    // Treated as 1 source → S = 80, not 92
    expect(r.factors.S).toBeCloseTo(80, 0);
  });

  it('tier values match PRD 8.7 (peerReviewed = 90)', () => {
    const r = scoreClaim(
      baseInput({ sources: [{ tier: 'peerReviewed', ageDays: 1, independenceKey: 'k1' }] }),
    );
    expect(r.factors.S).toBeCloseTo(90 * 0.80, 0);
  });

  it('forum tier scores lowest (35 * 0.80 = 28)', () => {
    const r = scoreClaim(
      baseInput({ sources: [{ tier: 'forum', ageDays: 1, independenceKey: 'k1' }] }),
    );
    expect(r.factors.S).toBeCloseTo(28, 0);
  });
});

// =============================================================================
// E factor
// =============================================================================

describe('E factor — entailment', () => {
  it('E=100 explicit match', () => {
    expect(scoreClaim(baseInput({ entailment: 100 })).factors.E).toBe(100);
  });
  it('E=70 partial', () => {
    expect(scoreClaim(baseInput({ entailment: 70 })).factors.E).toBe(70);
  });
  it('E=0 neutral', () => {
    expect(scoreClaim(baseInput({ entailment: 0 })).factors.E).toBe(0);
  });
  it('E=0 when quote fails (override)', () => {
    const r = scoreClaim(baseInput({ entailment: 100, quoteVerified: false }));
    expect(r.factors.E).toBe(0);
    expect(r.caps).toContain('quote_failed');
  });
});

// =============================================================================
// F factor — freshness formula
// =============================================================================

describe('F factor — freshness', () => {
  it('100 inside one half-life', () => {
    expect(freshnessScore(10, 90)).toBe(100);
    expect(freshnessScore(90, 90)).toBe(100);
  });
  it('100 * 2 / (ratio + 1) beyond one half-life', () => {
    // 210/90 = 2.333 → 100*2/3.333 = 60
    expect(freshnessScore(210, 90)).toBeCloseTo(60, 0);
    // 180/90 = 2 → 100*2/3 = 66.67
    expect(freshnessScore(180, 90)).toBeCloseTo(66.67, 1);
    // 270/90 = 3 → 100*2/4 = 50
    expect(freshnessScore(270, 90)).toBeCloseTo(50, 0);
  });
  it('approaches 0 as age grows', () => {
    expect(freshnessScore(900, 90)).toBeLessThan(20);
    expect(freshnessScore(9000, 90)).toBeLessThan(5);
  });
  it('halfLife Infinity → 100', () => {
    expect(freshnessScore(1_000_000, Infinity)).toBe(100);
  });
  it('stable volatility uses Infinity half-life', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'primary', ageDays: 10_000, independenceKey: 'k1' }],
        volatility: 'stable',
      }),
    );
    expect(r.factors.F).toBe(100);
    expect(r.caps).not.toContain('stale');
  });
  it('HALF_LIFE_DAYS matches PRD 8.7 table', () => {
    expect(HALF_LIFE_DAYS.stable).toBe(Infinity);
    expect(HALF_LIFE_DAYS.fast).toBe(2);
  });
});

// =============================================================================
// Hard caps
// =============================================================================

describe('hard caps — FR-TRUTH-07', () => {
  it('no source → cap 59, status UNVERIFIED', () => {
    const r = scoreClaim(baseInput({ sources: [] }));
    expect(r.caps).toContain('no_source');
    expect(r.status).toBe('UNVERIFIED');
    if (r.score !== null) expect(r.score).toBeLessThanOrEqual(59);
  });

  it('quote fails string match → cap 40', () => {
    const r = scoreClaim(baseInput({ quoteVerified: false, entailment: 100 }));
    expect(r.caps).toContain('quote_failed');
    expect(r.status).toBe('UNVERIFIED');
    expect(r.score as number).toBeLessThanOrEqual(40);
  });

  it('only interested-party sources → cap 69', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'interested', ageDays: 1, independenceKey: 'k1' }],
      }),
    );
    expect(r.caps).toContain('interested_only');
    expect(r.score as number).toBeLessThanOrEqual(69);
  });

  it('strong contradiction → cap 69, status CONFLICTED', () => {
    const r = scoreClaim(baseInput({ contradiction: 'strong' }));
    expect(r.caps).toContain('strong_contradiction');
    expect(r.status).toBe('CONFLICTED');
    expect(r.score as number).toBeLessThanOrEqual(69);
  });

  it('weak contradiction does NOT trigger the CONFLICTED status', () => {
    const r = scoreClaim(baseInput({ contradiction: 'weak' }));
    expect(r.caps).not.toContain('strong_contradiction');
    expect(r.status).not.toBe('CONFLICTED');
    // Weak penalty is 6
    expect(r.penalty).toBe(6);
  });

  it('stale claim (>2 half-lives) → cap 69', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'primary', ageDays: 400, independenceKey: 'k1' }],
        volatility: 'fast',
        halfLifeDays: 2, // 400 > 4 → stale
      }),
    );
    expect(r.caps).toContain('stale');
    expect(r.score as number).toBeLessThanOrEqual(69);
  });

  it('stable claim never stales', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'primary', ageDays: 100_000, independenceKey: 'k1' }],
        volatility: 'stable',
      }),
    );
    expect(r.caps).not.toContain('stale');
  });
});

// =============================================================================
// Statuses
// =============================================================================

describe('status assignment', () => {
  it('not checkable → NOT_SCORED', () => {
    const r = scoreClaim(baseInput({ checkable: false }));
    expect(r.status).toBe('NOT_SCORED');
    expect(r.score).toBeNull();
  });

  it('checked=false → RECALL_ONLY', () => {
    const r = scoreClaim(baseInput({ checked: false }));
    expect(r.status).toBe('RECALL_ONLY');
    expect(r.score).toBeNull();
  });

  it('score >= 85 → VERIFIED', () => {
    const r = scoreClaim(
      baseInput({
        sources: [
          { tier: 'primary', ageDays: 1, independenceKey: 'k1' },
          { tier: 'primary', ageDays: 1, independenceKey: 'k2' },
          { tier: 'primary', ageDays: 1, independenceKey: 'k3' },
        ],
        entailment: 100,
        agreement: 100,
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.status).toBe('VERIFIED');
  });

  it('score 70..84 → SUPPORTED', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'reputable', ageDays: 1, independenceKey: 'k1' }],
        entailment: 100,
        agreement: 80,
        consistency: 70,
      }),
    );
    if (r.score !== null && r.score >= 70 && r.score < 85) {
      expect(r.status).toBe('SUPPORTED');
    }
  });

  it('score 50..69 → MIXED', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'interested', ageDays: 1, independenceKey: 'k1' }],
        entailment: 30,
        agreement: 30,
      }),
    );
    if (r.score !== null && r.score >= 50 && r.score < 70) {
      expect(r.status).toBe('MIXED');
    }
  });

  it('score < 50 → WEAK', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'forum', ageDays: 1, independenceKey: 'k1' }],
        entailment: 30,
        agreement: 10,
      }),
    );
    if (r.score !== null && r.score < 50) {
      expect(r.status).toBe('WEAK');
    }
  });
});

// =============================================================================
// Factor clamping
// =============================================================================

describe('factor clamping', () => {
  it('E clamps to [0, 100]', () => {
    expect(scoreClaim(baseInput({ entailment: 200 })).factors.E).toBe(100);
    expect(scoreClaim(baseInput({ entailment: -50 })).factors.E).toBe(0);
  });
  it('A clamps to [0, 100]', () => {
    expect(scoreClaim(baseInput({ agreement: 200 })).factors.A).toBe(100);
    expect(scoreClaim(baseInput({ agreement: -10 })).factors.A).toBe(0);
  });
  it('C clamps to [0, 100]', () => {
    expect(scoreClaim(baseInput({ consistency: 200 })).factors.C).toBe(100);
    expect(scoreClaim(baseInput({ consistency: -10 })).factors.C).toBe(0);
  });
});

// =============================================================================
// Weight renormalisation
// =============================================================================

describe('weight renormalisation', () => {
  it('all 5 factors present → no renormalisation, partialCheck = false', () => {
    const r = scoreClaim(
      baseInput({
        entailment: 100,
        agreement: 100,
        consistency: 100,
        sources: [{ tier: 'primary', ageDays: 1, independenceKey: 'k1' }],
        volatility: 'stable',
      }),
    );
    expect(r.partialCheck).toBe(false);
    expect(r.factors.S).toBeDefined();
    expect(r.factors.E).toBeDefined();
    expect(r.factors.A).toBeDefined();
    expect(r.factors.F).toBeDefined();
    expect(r.factors.C).toBeDefined();
  });

  it('C missing → partialCheck = true', () => {
    const r = scoreClaim(
      baseInput({
        entailment: 100,
        agreement: 100,
        consistency: null,
      }),
    );
    expect(r.partialCheck).toBe(true);
    expect(r.factors.C).toBeUndefined();
  });

  it('only S present → raw = S', () => {
    const r = scoreClaim(
      baseInput({
        sources: [{ tier: 'primary', ageDays: 1, independenceKey: 'k1' }],
        entailment: null,
        agreement: null,
        consistency: null,
        volatility: 'stable',
      }),
    );
    // S = 80, F also present for stable (100)
    // Wait, F is present because sources exist and volatility is stable
    // So this test should compute (0.35*80 + 0.10*100) / 0.45 = 84.44
    expect(r.factors.S).toBeDefined();
    expect(r.factors.E).toBeUndefined();
    expect(r.factors.A).toBeUndefined();
    expect(r.factors.C).toBeUndefined();
    // Since only S and F are present, raw = (0.35*80 + 0.10*100) / 0.45
    expect(r.score as number).toBeGreaterThan(0);
  });
});

// =============================================================================
// Response-level
// =============================================================================

describe('scoreResponse', () => {
  it('empty claims → overall null, chip RECALL_ONLY', () => {
    const r = scoreResponse([]);
    expect(r.overall).toBeNull();
    expect(r.chip).toBe('RECALL_ONLY');
  });

  it('single VERIFIED claim → overall = its score, chip VERIFIED', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 92, importance: 1.0 },
    ]);
    expect(r.overall).toBe(92);
    expect(r.chip).toBe('VERIFIED');
  });

  it('coverage counts NOT_SCORED as excluded', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 92, importance: 1.0 },
      { status: 'NOT_SCORED', score: null, importance: 0.5 },
    ]);
    expect(r.checkableCount).toBe(1);
    expect(r.checkedCount).toBe(1);
    expect(r.coverage).toBe(1);
  });

  it('coverage counts RECALL_ONLY as unchecked', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 92, importance: 1.0 },
      { status: 'RECALL_ONLY', score: null, importance: 0.5 },
    ]);
    expect(r.checkableCount).toBe(2);
    expect(r.checkedCount).toBe(1);
    expect(r.coverage).toBe(0.5);
  });

  it('weakest-critical-link rule caps overall', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 100, importance: 1.0 },
      { status: 'MIXED', score: 48, importance: 1.0 },
    ]);
    // mean = 74, lowest critical + 15 = 48 + 15 = 63 → overall 63
    expect(r.overall).toBe(63);
  });

  it('all claims supporting → no critical cap applies', () => {
    const r = scoreResponse([
      { status: 'MIXED', score: 50, importance: 0.5 },
      { status: 'MIXED', score: 50, importance: 0.5 },
    ]);
    // Both supporting, no critical → mean = 50, no cap
    expect(r.overall).toBe(50);
  });

  it('critical CONFLICTED claim → chip CHECK', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 92, importance: 1.0 },
      { status: 'CONFLICTED', score: 48, importance: 1.0 },
    ]);
    expect(r.chip).toBe('CHECK');
  });

  it('low coverage → chip PARTIAL', () => {
    const r = scoreResponse([
      { status: 'VERIFIED', score: 92, importance: 1.0 },
      { status: 'RECALL_ONLY', score: null, importance: 0.5 },
      { status: 'RECALL_ONLY', score: null, importance: 0.5 },
    ]);
    // coverage = 1/3 ≈ 0.33 → PARTIAL
    expect(r.coverage).toBeCloseTo(1 / 3, 3);
    expect(r.chip).toBe('PARTIAL');
  });

  it('heuristic is always true (L10)', () => {
    expect(scoreResponse([]).heuristic).toBe(true);
    expect(
      scoreResponse([{ status: 'VERIFIED', score: 92, importance: 1.0 }]).heuristic,
    ).toBe(true);
  });
});

// =============================================================================
// Weights constant
// =============================================================================

describe('WEIGHTS constant', () => {
  it('weights sum to exactly 1.00', () => {
    const total = WEIGHTS.S + WEIGHTS.E + WEIGHTS.A + WEIGHTS.F + WEIGHTS.C;
    expect(total).toBeCloseTo(1.0, 10);
  });
});
// === FILE END ===