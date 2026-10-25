// === FILE START ===
// packages/truth-score/test/conflict.test.ts
// PRD 8.3 step 7 · 8.6 · FR-TRUTH-11 · F-038.
//
// One test per cause hypothesis, plus PRD 8.6 worked examples, plus
// integration through runPipeline.

import { describe, it, expect } from 'vitest';
import {
  analyzeConflicts,
  inferCause,
  type ConflictAnalysis,
} from '../src/conflict.js';
import { runPipeline } from '../src/pipeline.js';
import type { Evidence, ClaimVerdict } from '../src/verdict.js';
import type {
  ClaimInput,
  FetchedSource,
  JudgeCall,
} from '../src/pipeline.js';
import type { ClaimStatus, SourceTier } from '../src/types.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function mkEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-test',
    sourceId: 'src-test',
    sourceTitle: 'Test Source',
    sourceUrl: 'https://example.com',
    sourceTier: 'primary',
    stance: 'supports',
    quote: 'a quote',
    quoteVerified: true,
    matchKind: 'exact',
    retrievedAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

function mkVerdict(overrides: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claimId: 'c1',
    claimText: 'Test claim',
    status: 'CONFLICTED',
    score: 48,
    evidence: [],
    caps: ['strong_contradiction'],
    penalty: 15,
    partialCheck: false,
    wouldStrengthen: [],
    glyph: '!',
    glyphMeaning: 'Conflicted',
    concordance: { supports: 0, contradicts: 0, neutral: 0 },
    evidenceStrength: 'weak',
    ...overrides,
  };
}

function source(overrides: Partial<FetchedSource> = {}): FetchedSource {
  return {
    id: 's1',
    url: 'https://example.com/page',
    title: 'Example Page',
    pageText: 'The default page text.',
    tier: 'primary',
    ageDays: 10,
    independenceKey: 'k1',
    retrievedAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimId: 'c1',
    text: 'Test claim',
    checkable: true,
    checked: true,
    volatility: 'stable',
    ...overrides,
  };
}

// =============================================================================
// inferCause — one test per cause hypothesis
// =============================================================================

describe('inferCause — one per PRD 8.3 step 7 cause', () => {
  it('different_year: spans reference different 4-digit years', () => {
    expect(
      inferCause(['started in Q3 2027'], ['started in Q3 2028']),
    ).toBe('different_year');
  });

  it('different_definition: spans use "defined as" / "definition"', () => {
    expect(
      inferCause(['the term is defined as X'], ['the term refers to Y']),
    ).toBe('different_definition');
  });

  it('different_method: spans use "measured" / "method"', () => {
    expect(
      inferCause(['measured using method A'], ['estimated using method B']),
    ).toBe('different_method');
  });

  it('updated_figure: spans mention "updated" / "revised"', () => {
    expect(
      inferCause(['value updated in 2024'], ['value from 2020 report']),
    ).toBe('updated_figure');
  });

  it('reporting_error: numeric mismatch with no other keyword', () => {
    expect(
      inferCause(['41 percent efficiency'], ['48 percent efficiency']),
    ).toBe('reporting_error');
  });

  it('different_scope: spans mention "region" / "population"', () => {
    expect(
      inferCause(['sample from this region'], ['sample from that population']),
    ).toBe('different_scope');
  });

  it('unknown: no keywords, no year conflict, no numeric mismatch', () => {
    expect(
      inferCause(['some text about something'], ['different text here']),
    ).toBe('unknown');
  });
});

// =============================================================================
// PRD 8.6 worked examples
// =============================================================================

describe('PRD 8.6 worked examples', () => {
  it('year conflict (2027 vs 2028)', () => {
    expect(
      inferCause(['production starts Q3 2027'], ['production starts Q3 2028']),
    ).toBe('different_year');
  });

  it('definition conflict', () => {
    expect(
      inferCause(
        ['the policy is defined as covering X'],
        ['the policy definition excludes X'],
      ),
    ).toBe('different_definition');
  });

  it('method conflict', () => {
    expect(
      inferCause(
        ['efficiency measured at 41%'],
        ['efficiency estimated at 42%'],
      ),
    ).toBe('different_method');
  });

  it('updated figure', () => {
    expect(
      inferCause(
        ['updated figure is 500'],
        ['previous figure was 400'],
      ),
    ).toBe('updated_figure');
  });

  it('reporting error', () => {
    expect(
      inferCause(['100 units shipped'], ['150 units shipped']),
    ).toBe('reporting_error');
  });
});

// =============================================================================
// analyzeConflicts — basic shape
// =============================================================================

describe('analyzeConflicts — basic shape', () => {
  it('no conflict: only supports', () => {
    const v = mkVerdict({
      evidence: [mkEvidence({ stance: 'supports', quoteVerified: true })],
    });
    const c = analyzeConflicts(v);
    expect(c.hasConflict).toBe(false);
    expect(c.confidence).toBe(0);
    expect(c.pairs).toEqual([]);
    expect(c.resolution.kind).toBe('unresolved');
    expect(c.resolution.winner).toBeNull();
  });

  it('no conflict: only contradicts', () => {
    const v = mkVerdict({
      evidence: [mkEvidence({ stance: 'contradicts', quoteVerified: true })],
    });
    const c = analyzeConflicts(v);
    expect(c.hasConflict).toBe(false);
  });

  it('no conflict: unverified contradicts do not trigger', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', quoteVerified: true }),
        mkEvidence({ stance: 'contradicts', quoteVerified: false }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.hasConflict).toBe(false);
  });

  it('real conflict: 1 supports + 1 contradicts', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', quote: 'Q3 2027' }),
        mkEvidence({ stance: 'contradicts', quote: 'Q3 2028' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.hasConflict).toBe(true);
    expect(c.supports.length).toBe(1);
    expect(c.contradicts.length).toBe(1);
    expect(c.pairs.length).toBe(1);
    expect(c.cause).toBe('different_year');
    expect(c.confidence).toBeGreaterThan(0.5);
  });
});

// =============================================================================
// analyzeConflicts — tier resolution
// =============================================================================

describe('analyzeConflicts — tier resolution', () => {
  it('primary (supports) > interested (contradicts) → supports wins', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', sourceTier: 'primary', quote: 'X 2027' }),
        mkEvidence({ stance: 'contradicts', sourceTier: 'interested', quote: 'X 2028' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.resolution.kind).toBe('best_tier_wins');
    expect(c.resolution.winner?.sourceTier).toBe('primary');
    expect(c.resolution.reason).toContain('Supports');
  });

  it('peerReviewed (contradicts) > reputable (supports) → contradicts wins', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', sourceTier: 'reputable', quote: 'A' }),
        mkEvidence({ stance: 'contradicts', sourceTier: 'peerReviewed', quote: 'B' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.resolution.kind).toBe('best_tier_wins');
    expect(c.resolution.winner?.sourceTier).toBe('peerReviewed');
    expect(c.resolution.reason).toContain('Contradicts');
  });

  it('equal tiers → unresolved', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', sourceTier: 'primary', quote: 'X' }),
        mkEvidence({ stance: 'contradicts', sourceTier: 'primary', quote: 'Y' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.resolution.kind).toBe('unresolved');
    expect(c.resolution.winner).toBeNull();
    expect(c.resolution.reason).toContain('equal');
  });
});

// =============================================================================
// analyzeConflicts — confidence scoring
// =============================================================================

describe('analyzeConflicts — confidence', () => {
  it('both verified, cause identified, tier resolved → highest confidence (1.0)', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', sourceTier: 'primary', quote: 'X 2027' }),
        mkEvidence({ stance: 'contradicts', sourceTier: 'interested', quote: 'X 2028' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('cause unknown → lower confidence', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', sourceTier: 'primary', quote: 'some text' }),
        mkEvidence({ stance: 'contradicts', sourceTier: 'primary', quote: 'other text' }),
      ],
    });
    const c = analyzeConflicts(v);
    expect(c.cause).toBe('unknown');
    // 0.5 base + 0.15 (both present) = 0.65 (cause unknown +0, tier unresolved +0)
    expect(c.confidence).toBeCloseTo(0.65, 1);
  });
});

// =============================================================================
// analyzeConflicts — pairs
// =============================================================================

describe('analyzeConflicts — pairs', () => {
  it('one pair per supports × contradicts combination', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', quote: 'X 2027' }),
        mkEvidence({ stance: 'supports', quote: 'X 2027 alt' }),
        mkEvidence({ stance: 'contradicts', quote: 'Y 2028' }),
      ],
    });
    const c = analyzeConflicts(v);
    // 2 supports × 1 contradicts = 2 pairs
    expect(c.pairs.length).toBe(2);
    for (const p of c.pairs) {
      expect(p.cause).toBe('different_year');
      expect(p.explanation).toContain('different years');
    }
  });

  it('pairs capped at 5', () => {
    const evidence: Evidence[] = [];
    for (let i = 0; i < 10; i++) {
      evidence.push(mkEvidence({ stance: 'supports', quote: 'S ' + i }));
      evidence.push(mkEvidence({ stance: 'contradicts', quote: 'C ' + i }));
    }
    const v = mkVerdict({ evidence });
    const c = analyzeConflicts(v);
    expect(c.pairs.length).toBe(5);
  });
});

// =============================================================================
// Integration through runPipeline
// =============================================================================

describe('runPipeline integration', () => {
  it('strong contradiction produces conflictAnalysis on the verdict', () => {
    const cl = claim({
      claimId: 'conflict-test',
      text: 'Production starts in Q3 2027.',
    });
    const srcA = source({
      id: 'src-a',
      pageText: 'The company says production starts in Q3 2027.',
      tier: 'primary',
      independenceKey: 'k-a',
    });
    const srcB = source({
      id: 'src-b',
      pageText: 'The paper appendix says production starts in Q3 2028.',
      tier: 'peerReviewed',
      independenceKey: 'k-b',
    });
    const judges: JudgeCall[] = [
      {
        sourceId: 'src-a',
        response: {
          stance: 'supports',
          span: 'production starts in Q3 2027',
          rationale: 'matches',
        },
      },
      {
        sourceId: 'src-b',
        response: {
          stance: 'contradicts',
          span: 'production starts in Q3 2028',
          rationale: 'different year',
        },
      },
    ];

    const result = runPipeline(cl, [srcA, srcB], judges);
    expect(result.verdict.status).toBe('CONFLICTED');
    expect(result.verdict.conflictAnalysis).toBeDefined();
    const c = result.verdict.conflictAnalysis!;
    expect(c.hasConflict).toBe(true);
    expect(c.cause).toBe('different_year');
    // primary + peerReviewed are both strong; tier resolution:
    // primary rank 6 > peerReviewed rank 5 → supports wins
    expect(c.resolution.kind).toBe('best_tier_wins');
    expect(c.resolution.winner?.sourceTier).toBe('primary');
    expect(c.confidence).toBeGreaterThan(0.5);
    // Trace contains conflict line
    expect(result.trace.some((t) => t.includes('[conflict]'))).toBe(true);
  });

  it('no conflict → conflictAnalysis is null', () => {
    const cl = claim({ claimId: 'no-conflict', text: 'The sky is blue.' });
    const src = source({
      id: 's-sky',
      pageText: 'The sky is blue.',
      tier: 'primary',
      independenceKey: 'k-sky',
    });
    const judges: JudgeCall[] = [
      {
        sourceId: 's-sky',
        response: { stance: 'supports', span: 'The sky is blue.', rationale: '' },
      },
    ];

    const result = runPipeline(cl, [src], judges);
    expect(result.verdict.status).not.toBe('CONFLICTED');
    expect(result.verdict.conflictAnalysis).toBeFalsy();
  });

  it('reporting error detected end-to-end', () => {
    const cl = claim({
      claimId: 'error-test',
      text: 'The company shipped 100 units.',
    });
    const srcA = source({
      id: 'srcA',
      pageText: 'The company shipped 100 units in Q1.',
      tier: 'primary',
      independenceKey: 'kA',
    });
    const srcB = source({
      id: 'srcB',
      pageText: 'Reports show the company shipped 150 units in Q1.',
      tier: 'reputable',
      independenceKey: 'kB',
    });
    const judges: JudgeCall[] = [
      {
        sourceId: 'srcA',
        response: { stance: 'supports', span: '100 units', rationale: '' },
      },
      {
        sourceId: 'srcB',
        response: { stance: 'contradicts', span: '150 units', rationale: '' },
      },
    ];

    const result = runPipeline(cl, [srcA, srcB], judges);
    expect(result.verdict.status).toBe('CONFLICTED');
    expect(result.verdict.conflictAnalysis!.cause).toBe('reporting_error');
  });
});

// =============================================================================
// Sanity: type shape
// =============================================================================

describe('ConflictAnalysis shape', () => {
  it('has all documented fields', () => {
    const v = mkVerdict({
      evidence: [
        mkEvidence({ stance: 'supports', quote: 'A 2027' }),
        mkEvidence({ stance: 'contradicts', quote: 'B 2028' }),
      ],
    });
    const c: ConflictAnalysis = analyzeConflicts(v);
    expect(typeof c.hasConflict).toBe('boolean');
    expect(Array.isArray(c.supports)).toBe(true);
    expect(Array.isArray(c.contradicts)).toBe(true);
    expect(Array.isArray(c.pairs)).toBe(true);
    expect(typeof c.cause).toBe('string');
    expect(typeof c.resolution.kind).toBe('string');
    expect(typeof c.explanation).toBe('string');
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
  });
});
// === FILE END ===