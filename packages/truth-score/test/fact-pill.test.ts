// === FILE START ===
// packages/truth-score/test/fact-pill.test.ts
// PRD 5.6 · 8.7 · 8.8 · F-035 · F-036 · L3 · T-32.
//
// One test per PRD 5.6 chip condition, plus the T-32 honesty gate:
// every Fact pill field must be provable from the input verdicts.

import { describe, it, expect } from 'vitest';
import {
  assembleFactPill,
  FACT_PILL_BANDS,
  type FactPillClaim,
} from '../src/fact-pill.js';
import type { ClaimVerdict } from '../src/verdict.js';
import type { ClaimStatus } from '../src/types.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function mkVerdict(
  status: ClaimStatus,
  score: number | null,
  overrides: Partial<ClaimVerdict> = {},
): ClaimVerdict {
  return {
    claimId: 'c',
    claimText: 'claim text',
    status,
    score,
    evidence: [],
    caps: [],
    penalty: 0,
    partialCheck: false,
    wouldStrengthen: ['Add a source'],
    glyph:
      status === 'VERIFIED'
        ? '◆'
        : status === 'SUPPORTED'
          ? '◇'
          : status === 'CONFLICTED'
            ? '!'
            : status === 'UNVERIFIED'
              ? '?'
              : status === 'RECALL_ONLY'
                ? '-'
                : status === 'NOT_SCORED'
                  ? ''
                  : '△',
    glyphMeaning: status,
    concordance: { supports: 0, contradicts: 0, neutral: 0 },
    evidenceStrength: 'none',
    ...overrides,
  };
}

function mk(
  status: ClaimStatus,
  score: number | null,
  importance: number,
  overrides: Partial<ClaimVerdict> = {},
): FactPillClaim {
  return { verdict: mkVerdict(status, score, overrides), importance };
}

// =============================================================================
// Constants
// =============================================================================

describe('FACT_PILL_BANDS', () => {
  it('matches PRD 8.8 bands', () => {
    expect(FACT_PILL_BANDS.verified).toBe(85);
    expect(FACT_PILL_BANDS.supported).toBe(70);
    expect(FACT_PILL_BANDS.mixed).toBe(50);
  });
});

// =============================================================================
// PRD 5.6 chip priority — one test per condition
// =============================================================================

describe('Chip priority — PRD 5.6', () => {
  it('empty claims → pill hidden', () => {
    const p = assembleFactPill([]);
    expect(p.visible).toBe(false);
    expect(p.chip).toBe('RECALL_ONLY');
    expect(p.showScore).toBe(false);
  });

  it('all NOT_SCORED → pill hidden', () => {
    const p = assembleFactPill([mk('NOT_SCORED', null, 0.5)]);
    expect(p.visible).toBe(false);
    expect(p.checkable).toBe(0);
  });

  it('all RECALL_ONLY → chip RECALL_ONLY, visible, no score', () => {
    const p = assembleFactPill([
      mk('RECALL_ONLY', null, 1.0),
      mk('RECALL_ONLY', null, 0.5),
    ]);
    expect(p.visible).toBe(true);
    expect(p.chip).toBe('RECALL_ONLY');
    expect(p.showScore).toBe(false);
    expect(p.overall).toBeNull();
    expect(p.checked).toBe(0);
    expect(p.checkable).toBe(2);
  });

  it('critical CONFLICTED → CHECK (highest priority)', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('CONFLICTED', 48, 1.0),
    ]);
    expect(p.chip).toBe('CHECK');
    expect(p.color).toBe('bad');
    expect(p.glyph).toBe('!');
  });

  it('coverage < 50% → PARTIAL', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('RECALL_ONLY', null, 0.5),
      mk('RECALL_ONLY', null, 0.5),
    ]);
    expect(p.chip).toBe('PARTIAL');
    expect(p.coverage).toBeCloseTo(1 / 3, 5);
    expect(p.color).toBe('grey');
  });

  it('overall ≥ 85 + no weak critical → VERIFIED', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('VERIFIED', 88, 1.0),
    ]);
    expect(p.chip).toBe('VERIFIED');
    expect(p.color).toBe('accent');
    expect(p.glyph).toBe('◆');
  });

  it('overall 70-84 → SUPPORTED', () => {
    const p = assembleFactPill([
      mk('SUPPORTED', 78, 1.0),
      mk('SUPPORTED', 82, 1.0),
    ]);
    expect(p.chip).toBe('SUPPORTED');
    expect(p.color).toBe('ink');
    expect(p.glyph).toBe('◇');
  });

  it('overall 50-69 → MIXED', () => {
    const p = assembleFactPill([
      mk('MIXED', 60, 1.0),
      mk('MIXED', 55, 1.0),
    ]);
    expect(p.chip).toBe('MIXED');
    expect(p.color).toBe('warn');
    expect(p.glyph).toBe('△');
  });

  it('overall < 50 → WEAK', () => {
    const p = assembleFactPill([
      mk('WEAK', 30, 1.0),
      mk('WEAK', 40, 1.0),
    ]);
    expect(p.chip).toBe('WEAK');
    expect(p.color).toBe('warn');
    expect(p.glyph).toBe('△');
  });

  it('VERIFIED gated by weak critical even when overall ≥ 85', () => {
    // Overall will be capped by the weak critical. Force it to still be
    // ≥ 85 arithmetically is impossible, but we assert the structural rule:
    // a critical RECALL_ONLY blocks VERIFIED.
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('RECALL_ONLY', null, 1.0), // critical and unchecked
    ]);
    // Coverage = 0.5 (not < 0.5), overall = 92, but RECALL_ONLY is critical
    expect(p.overall).toBe(92);
    expect(p.chip).not.toBe('VERIFIED');
    expect(['SUPPORTED', 'PARTIAL', 'MIXED', 'WEAK']).toContain(p.chip);
  });
});

// =============================================================================
// T-32 honesty — every displayed field is provable
// =============================================================================

describe('T-32 honesty — every Fact pill field is provable', () => {
  it('overall matches the weighted mean capped by critical + 15', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('CONFLICTED', 48, 1.0),
    ]);
    // mean = 70, weakestBound = 48+15 = 63 → overall = 63
    expect(p.overall).toBe(63);
  });

  it('overall is null when nothing is scored', () => {
    const p = assembleFactPill([
      mk('RECALL_ONLY', null, 1.0),
      mk('NOT_SCORED', null, 0.5),
    ]);
    expect(p.overall).toBeNull();
  });

  it('coverage equals checked / checkable', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('RECALL_ONLY', null, 0.5),
    ]);
    expect(p.coverage).toBe(0.5);
    expect(p.checked).toBe(1);
    expect(p.checkable).toBe(2);
  });

  it('coverage is vacuous-1 for empty input', () => {
    const p = assembleFactPill([]);
    expect(p.coverage).toBe(1);
  });

  it('checked === checkable when everything is checked', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('SUPPORTED', 80, 1.0),
    ]);
    expect(p.checked).toBe(p.checkable);
  });

  it('showScore false when coverage === 0 (L3)', () => {
    const p = assembleFactPill([
      mk('RECALL_ONLY', null, 1.0),
      mk('RECALL_ONLY', null, 0.5),
    ]);
    expect(p.coverage).toBe(0);
    expect(p.showScore).toBe(false);
    expect(p.overall).toBeNull();
  });

  it('showScore true when coverage > 0 and overall exists', () => {
    const p = assembleFactPill([mk('VERIFIED', 92, 1.0)]);
    expect(p.coverage).toBe(1);
    expect(p.overall).toBe(92);
    expect(p.showScore).toBe(true);
  });

  it('heuristic is always true (L10)', () => {
    for (const claims of [
      [],
      [mk('VERIFIED', 92, 1.0)],
      [mk('RECALL_ONLY', null, 1.0)],
      [mk('NOT_SCORED', null, 0.5)],
    ]) {
      expect(assembleFactPill(claims).heuristic).toBe(true);
    }
  });

  it('ariaLabel includes the number when showScore is true', () => {
    const p = assembleFactPill([mk('VERIFIED', 92, 1.0)]);
    expect(p.ariaLabel).toContain('92');
    expect(p.ariaLabel).toContain('1 of 1');
    expect(p.ariaLabel).toContain('verified');
  });

  it('ariaLabel omits the number when showScore is false', () => {
    const p = assembleFactPill([mk('RECALL_ONLY', null, 1.0)]);
    expect(p.ariaLabel).not.toContain('out of 100');
    expect(p.ariaLabel).toContain('0 of 1');
    expect(p.ariaLabel).toContain('recall-only');
  });
});

// =============================================================================
// Label + color + glyph — every chip
// =============================================================================

describe('Chip label/color/glyph — exact mapping', () => {
  it('CHECK → "Check" / bad / !', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('CONFLICTED', 48, 1.0),
    ]);
    expect(p.label).toBe('Check');
    expect(p.color).toBe('bad');
    expect(p.glyph).toBe('!');
  });

  it('PARTIAL → "Partial" / grey / -', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('RECALL_ONLY', null, 0.5),
      mk('RECALL_ONLY', null, 0.5),
    ]);
    expect(p.label).toBe('Partial');
    expect(p.color).toBe('grey');
    expect(p.glyph).toBe('-');
  });

  it('VERIFIED → "Verified" / accent / ◆', () => {
    const p = assembleFactPill([
      mk('VERIFIED', 92, 1.0),
      mk('VERIFIED', 88, 1.0),
    ]);
    expect(p.label).toBe('Verified');
    expect(p.color).toBe('accent');
    expect(p.glyph).toBe('◆');
  });

  it('SUPPORTED → "Supported" / ink / ◇', () => {
    const p = assembleFactPill([
      mk('SUPPORTED', 78, 1.0),
      mk('SUPPORTED', 82, 1.0),
    ]);
    expect(p.label).toBe('Supported');
    expect(p.color).toBe('ink');
    expect(p.glyph).toBe('◇');
  });

  it('MIXED → "Mixed" / warn / △', () => {
    const p = assembleFactPill([
      mk('MIXED', 60, 1.0),
      mk('MIXED', 55, 1.0),
    ]);
    expect(p.label).toBe('Mixed');
    expect(p.color).toBe('warn');
    expect(p.glyph).toBe('△');
  });

  it('WEAK → "Weak" / warn / △', () => {
    const p = assembleFactPill([
      mk('WEAK', 30, 1.0),
      mk('WEAK', 40, 1.0),
    ]);
    expect(p.label).toBe('Weak');
    expect(p.color).toBe('warn');
    expect(p.glyph).toBe('△');
  });

  it('RECALL_ONLY → "Recall-only" / grey / -', () => {
    const p = assembleFactPill([mk('RECALL_ONLY', null, 1.0)]);
    expect(p.label).toBe('Recall-only');
    expect(p.color).toBe('grey');
    expect(p.glyph).toBe('-');
  });
});
// === FILE END ===