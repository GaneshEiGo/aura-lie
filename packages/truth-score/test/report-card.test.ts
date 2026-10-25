// === FILE START ===
// packages/truth-score/test/report-card.test.ts
// PRD FR-TRUTH-12 · FR-TRUTH-18 · 5.6 · 8.7 · T-32.
//
// One test per report-card bar, plus honesty invariants:
// every non-null score is recomputable; every null score corresponds to a
// genuinely missing input.

import { describe, it, expect } from 'vitest';
import {
  assembleReportCard,
  type ActionInput,
} from '../src/report-card.js';
import type { FactPillClaim } from '../src/fact-pill.js';
import type { Evidence, ClaimVerdict } from '../src/verdict.js';
import type { ClaimStatus } from '../src/types.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function mkEvidence(
  sourceId: string,
  quoteVerified: boolean,
): Evidence {
  return {
    id: `ev-${sourceId}`,
    sourceId,
    sourceTitle: 'title',
    sourceUrl: 'https://x',
    sourceTier: 'primary',
    stance: quoteVerified ? 'supports' : 'neutral',
    quote: quoteVerified ? 'a quote' : null,
    quoteVerified,
    matchKind: quoteVerified ? 'exact' : 'not_found',
    retrievedAt: '2026-10-02T10:00:00Z',
  };
}

function mkVerdict(
  status: ClaimStatus,
  score: number | null,
  overrides: Partial<ClaimVerdict> = {},
): ClaimVerdict {
  return {
    claimId: 'c',
    claimText: 'claim',
    status,
    score,
    evidence: [],
    caps: [],
    penalty: 0,
    partialCheck: false,
    wouldStrengthen: [],
    glyph: '',
    glyphMeaning: status,
    concordance: { supports: 0, contradicts: 0, neutral: 0 },
    evidenceStrength: 'none',
    ...overrides,
  };
}

function mk(
  status: ClaimStatus,
  score: number | null,
  overrides: Partial<ClaimVerdict> = {},
): FactPillClaim {
  return { verdict: mkVerdict(status, score, overrides), importance: 1.0 };
}

// =============================================================================
// Evidence bar
// =============================================================================

describe('Evidence bar', () => {
  it('all scored claims have verified evidence → score 1', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { evidence: [mkEvidence('s1', true)] }),
        mk('VERIFIED', 90, { evidence: [mkEvidence('s2', true)] }),
      ],
    });
    expect(card.evidence.score).toBe(1);
    expect(card.evidence.color).toBe('ok');
    expect(card.evidence.note).toContain('2 of 2');
  });

  it('half scored claims have verified evidence → score 0.5', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { evidence: [mkEvidence('s1', true)] }),
        mk('UNVERIFIED', 40, { evidence: [mkEvidence('s2', false)] }),
      ],
    });
    expect(card.evidence.score).toBe(0.5);
    expect(card.evidence.color).toBe('warn');
  });

  it('no verified evidence → score 0', () => {
    const card = assembleReportCard({
      claims: [mk('UNVERIFIED', 40, { evidence: [mkEvidence('s1', false)] })],
    });
    expect(card.evidence.score).toBe(0);
    expect(card.evidence.color).toBe('bad');
  });

  it('no scored claims → score null, color grey', () => {
    const card = assembleReportCard({
      claims: [mk('RECALL_ONLY', null)],
    });
    expect(card.evidence.score).toBeNull();
    expect(card.evidence.color).toBe('grey');
    expect(card.evidence.note).toContain('No claims');
  });
});

// =============================================================================
// Sources bar
// =============================================================================

describe('Sources bar', () => {
  it('3 distinct verified sources → score 1', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { evidence: [mkEvidence('a', true)] }),
        mk('VERIFIED', 88, { evidence: [mkEvidence('b', true)] }),
        mk('VERIFIED', 90, { evidence: [mkEvidence('c', true)] }),
      ],
    });
    expect(card.sources.score).toBe(1);
    expect(card.sources.color).toBe('ok');
    expect(card.sources.note).toContain('3 distinct');
  });

  it('1 distinct verified source → score 1/3', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92, { evidence: [mkEvidence('a', true)] })],
    });
    expect(card.sources.score).toBeCloseTo(1 / 3, 5);
    expect(card.sources.color).toBe('bad');
  });

  it('duplicate sourceIds count once', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { evidence: [mkEvidence('a', true)] }),
        mk('VERIFIED', 88, { evidence: [mkEvidence('a', true)] }),
      ],
    });
    // Only 'a' counts → 1 distinct → 1/3
    expect(card.sources.score).toBeCloseTo(1 / 3, 5);
  });

  it('unverified evidence does NOT count', () => {
    const card = assembleReportCard({
      claims: [mk('UNVERIFIED', 40, { evidence: [mkEvidence('a', false)] })],
    });
    expect(card.sources.score).toBe(0);
    expect(card.sources.color).toBe('bad');
    expect(card.sources.note).toContain('No verified');
  });

  it('4 distinct sources → capped at score 1', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, {
          evidence: [
            mkEvidence('a', true),
            mkEvidence('b', true),
            mkEvidence('c', true),
            mkEvidence('d', true),
          ],
        }),
      ],
    });
    expect(card.sources.score).toBe(1);
  });
});

// =============================================================================
// Freshness bar
// =============================================================================

describe('Freshness bar', () => {
  it('no stale claims → score 1', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { caps: [] }),
        mk('SUPPORTED', 80, { caps: [] }),
      ],
    });
    expect(card.freshness.score).toBe(1);
    expect(card.freshness.color).toBe('ok');
    expect(card.freshness.note).toContain('2 of 2');
  });

  it('half stale → score 0.5', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { caps: [] }),
        mk('MIXED', 55, { caps: ['stale'] }),
      ],
    });
    expect(card.freshness.score).toBe(0.5);
    expect(card.freshness.color).toBe('warn');
  });

  it('all stale → score 0', () => {
    const card = assembleReportCard({
      claims: [mk('MIXED', 55, { caps: ['stale'] })],
    });
    expect(card.freshness.score).toBe(0);
    expect(card.freshness.color).toBe('bad');
  });

  it('no scored claims → score null', () => {
    const card = assembleReportCard({ claims: [mk('RECALL_ONLY', null)] });
    expect(card.freshness.score).toBeNull();
    expect(card.freshness.color).toBe('grey');
  });
});

// =============================================================================
// Reasoning check bar
// =============================================================================

describe('Reasoning check bar', () => {
  it('critic passed → score 1', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      criticResult: 'pass',
    });
    expect(card.reasoning.score).toBe(1);
    expect(card.reasoning.color).toBe('ok');
    expect(card.reasoning.note).toContain('passed');
  });

  it('critic failed → score 0', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      criticResult: 'fail',
    });
    expect(card.reasoning.score).toBe(0);
    expect(card.reasoning.color).toBe('bad');
    expect(card.reasoning.note).toContain('issues');
  });

  it('critic not run → score null, grey', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
    });
    expect(card.reasoning.score).toBeNull();
    expect(card.reasoning.color).toBe('grey');
    expect(card.reasoning.note).toContain('did not run');
  });
});

// =============================================================================
// Completeness bar
// =============================================================================

describe('Completeness bar', () => {
  it('completeness 0.9 → score 0.9, color ok', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      completenessScore: 0.9,
    });
    expect(card.completeness.score).toBe(0.9);
    expect(card.completeness.color).toBe('ok');
    expect(card.completeness.note).toContain('90%');
  });

  it('completeness 0.3 → score 0.3, color bad', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      completenessScore: 0.3,
    });
    expect(card.completeness.score).toBe(0.3);
    expect(card.completeness.color).toBe('bad');
  });

  it('completeness not provided → score null, grey', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
    });
    expect(card.completeness.score).toBeNull();
    expect(card.completeness.color).toBe('grey');
    expect(card.completeness.note).toContain('Not evaluated');
  });
});

// =============================================================================
// Action safety bar (conditional)
// =============================================================================

describe('Action safety bar', () => {
  it('no actions → null', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
    });
    expect(card.actionSafety).toBeNull();
  });

  it('empty actions array → null', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      actions: [],
    });
    expect(card.actionSafety).toBeNull();
  });

  it('all safe actions → score 1, color ok', () => {
    const actions: ActionInput[] = [{ safety: 'safe' }, { safety: 'safe' }];
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      actions,
    });
    expect(card.actionSafety).not.toBeNull();
    expect(card.actionSafety!.score).toBe(1);
    expect(card.actionSafety!.color).toBe('ok');
    expect(card.actionSafety!.note).toBe('2 safe');
  });

  it('one safe + one needs_approval → score 0.75', () => {
    const actions: ActionInput[] = [{ safety: 'safe' }, { safety: 'needs_approval' }];
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      actions,
    });
    expect(card.actionSafety!.score).toBe(0.75);
    expect(card.actionSafety!.color).toBe('warn');
    expect(card.actionSafety!.note).toBe('1 safe, 1 needs approval');
  });

  it('any blocked → score 0, color bad', () => {
    const actions: ActionInput[] = [{ safety: 'blocked' }];
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      actions,
    });
    expect(card.actionSafety!.score).toBe(0);
    expect(card.actionSafety!.color).toBe('bad');
    expect(card.actionSafety!.note).toBe('1 blocked');
  });
});

// =============================================================================
// wouldStrengthen aggregation
// =============================================================================

describe('wouldStrengthen aggregation', () => {
  it('merges advice from every claim', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { wouldStrengthen: ['Add a source'] }),
        mk('MIXED', 60, { wouldStrengthen: ['Re-check the citation'] }),
      ],
    });
    expect(card.wouldStrengthen).toEqual([
      'Add a source',
      'Re-check the citation',
    ]);
  });

  it('dedupes identical advice', () => {
    const card = assembleReportCard({
      claims: [
        mk('MIXED', 60, { wouldStrengthen: ['Add a source'] }),
        mk('MIXED', 55, { wouldStrengthen: ['Add a source'] }),
      ],
    });
    expect(card.wouldStrengthen).toEqual(['Add a source']);
  });

  it('caps at 5 entries', () => {
    const advice = (n: number) =>
      Array.from({ length: n }, (_, i) => `Advice ${i}`);
    const card = assembleReportCard({
      claims: [mk('WEAK', 30, { wouldStrengthen: advice(10) })],
    });
    expect(card.wouldStrengthen.length).toBe(5);
  });

  it('empty when no claims have advice', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92, { wouldStrengthen: [] })],
    });
    expect(card.wouldStrengthen).toEqual([]);
  });
});

// =============================================================================
// T-32 honesty — every non-null score is provable
// =============================================================================

describe('T-32 honesty — every report card score is provable', () => {
  it('every bar has a matching id and label', () => {
    const card = assembleReportCard({
      claims: [mk('VERIFIED', 92)],
      actions: [{ safety: 'safe' }],
    });
    expect(card.evidence.id).toBe('evidence');
    expect(card.sources.id).toBe('sources');
    expect(card.freshness.id).toBe('freshness');
    expect(card.reasoning.id).toBe('reasoning');
    expect(card.completeness.id).toBe('completeness');
    expect(card.actionSafety!.id).toBe('actionSafety');
  });

  it('evidence/sources/freshness scores are 0..1 or null', () => {
    const card = assembleReportCard({
      claims: [
        mk('VERIFIED', 92, { evidence: [mkEvidence('a', true)] }),
        mk('UNVERIFIED', 40, { caps: ['stale'] }),
      ],
    });
    for (const bar of [card.evidence, card.sources, card.freshness]) {
      if (bar.score !== null) {
        expect(bar.score).toBeGreaterThanOrEqual(0);
        expect(bar.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('null scores only appear when input lacks the necessary data', () => {
    const card = assembleReportCard({
      claims: [mk('RECALL_ONLY', null)],
      // No criticResult, no completenessScore, no actions
    });
    // Evidence/freshness null because no scored claims
    expect(card.evidence.score).toBeNull();
    expect(card.freshness.score).toBeNull();
    // Sources 0 (no verified evidence)
    expect(card.sources.score).toBe(0);
    // Reasoning null (no criticResult)
    expect(card.reasoning.score).toBeNull();
    // Completeness null (no completenessScore)
    expect(card.completeness.score).toBeNull();
    // Action safety null (no actions)
    expect(card.actionSafety).toBeNull();
  });

  it('color = grey exactly when score = null', () => {
    const card = assembleReportCard({
      claims: [mk('RECALL_ONLY', null)],
    });
    const bars = [
      card.evidence,
      card.sources,
      card.freshness,
      card.reasoning,
      card.completeness,
    ];
    for (const bar of bars) {
      if (bar.score === null) {
        expect(bar.color).toBe('grey');
      } else {
        expect(bar.color).not.toBe('grey');
      }
    }
  });
});
// === FILE END ===