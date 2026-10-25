// === FILE START ===
// packages/truth-score/test/pipeline.test.ts
// PRD 8.3 · 8.4 · 8.7 · T-06 · F-031 to F-038.
//
// The T-06 gate: 5 seeded claims, one per outcome, all proven end-to-end.
// Plus edge cases for fabricated quotes, partial checks, and multi-source
// verdicts. Every test asserts the exact glyph and the exact cap.

import { describe, it, expect } from 'vitest';
import { runPipeline, buildVerdict } from '../src/pipeline.js';
import type {
  ClaimInput,
  FetchedSource,
  JudgeCall,
} from '../src/pipeline.js';

// -----------------------------------------------------------------------------
// Fixture builders
// -----------------------------------------------------------------------------

function claim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimId: 'c1',
    text: 'Default claim text.',
    checkable: true,
    checked: true,
    volatility: 'stable',
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

function judge(overrides: Partial<JudgeCall> = {}): JudgeCall {
  return {
    sourceId: 's1',
    response: {
      stance: 'supports',
      span: 'default page text',
      rationale: 'direct match',
    },
    ...overrides,
  };
}

// =============================================================================
// T-06 gate — 5 seeded claims, one per outcome
// =============================================================================

describe('T-06 — Truth Engine end-to-end (5 seeded claims)', () => {
  // ---------------------------------------------------------------------------
  // Case 1 — clean support: 1 primary source, verified quote, no contradiction
  // → VERIFIED, glyph ◆, no caps, no penalty
  // ---------------------------------------------------------------------------
  it('T-06.1 clean support → VERIFIED, glyph ◆', () => {
    const cl = claim({
      claimId: 't06-clean',
      text: 'The speed of light is about 299,792 km per second.',
      volatility: 'stable',
    });
    const src = source({
      id: 's-light',
      pageText:
        'The speed of light in vacuum is about 299,792 km per second, a well-known constant.',
      tier: 'primary',
      ageDays: 10,
      independenceKey: 'k-light',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 's-light',
        response: {
          stance: 'supports',
          span: 'about 299,792 km per second',
          rationale: 'direct statement',
        },
      },
    ];

    const { verdict, trace } = runPipeline(cl, [src], jr);

    expect(verdict.status).toBe('VERIFIED');
    expect(verdict.glyph).toBe('◆');
    expect(verdict.glyphMeaning).toBe('Verified');
    expect(verdict.score).not.toBeNull();
    expect(verdict.score as number).toBeGreaterThanOrEqual(85);
    expect(verdict.caps).toEqual([]);
    expect(verdict.penalty).toBe(0);
    expect(verdict.evidence.length).toBe(1);
    expect(verdict.evidence[0].quoteVerified).toBe(true);
    expect(verdict.evidence[0].quote).toBe('about 299,792 km per second');
    expect(verdict.evidence[0].matchKind).toBe('exact');
    expect(verdict.concordance).toEqual({
      supports: 1,
      contradicts: 0,
      neutral: 0,
    });
    expect(verdict.evidenceStrength).toBe('moderate');
    expect(verdict.wouldStrengthen.length).toBeGreaterThan(0);
    // Trace contains real steps
    expect(trace.length).toBeGreaterThan(2);
    expect(trace.join(' ')).toContain('quote-span');
    expect(trace.join(' ')).toContain('score');
  });

  // ---------------------------------------------------------------------------
  // Case 2 — no source: sources=[] → UNVERIFIED, glyph ?, cap ≤ 59
  // ---------------------------------------------------------------------------
  it('T-06.2 no source → UNVERIFIED, glyph ?, score ≤ 59', () => {
    const cl = claim({
      claimId: 't06-nosrc',
      text: 'Aliens visited Earth in 2024.',
      volatility: 'fast',
      halfLifeDays: 90,
    });

    const { verdict } = runPipeline(cl, [], []);

    expect(verdict.status).toBe('UNVERIFIED');
    expect(verdict.glyph).toBe('?');
    expect(verdict.glyphMeaning).toBe('Unverified');
    expect(verdict.caps).toContain('no_source');
    if (verdict.score !== null) {
      expect(verdict.score).toBeLessThanOrEqual(59);
    }
    expect(verdict.concordance).toEqual({
      supports: 0,
      contradicts: 0,
      neutral: 0,
    });
    expect(verdict.evidenceStrength).toBe('none');
    expect(verdict.wouldStrengthen.length).toBeGreaterThan(0);
    expect(verdict.wouldStrengthen.join(' ').toLowerCase()).toContain('source');
  });

  // ---------------------------------------------------------------------------
  // Case 3 — contradiction: 1 peer-reviewed source contradicts
  // → CONFLICTED, glyph !, cap ≤ 69, penalty 15
  // ---------------------------------------------------------------------------
  it('T-06.3 strong contradiction → CONFLICTED, glyph !, score ≤ 69', () => {
    const cl = claim({
      claimId: 't06-contra',
      text: 'The company produced 1 million units in 2024.',
      volatility: 'slow',
    });
    const src = source({
      id: 's-report',
      pageText:
        'The company produced 500,000 units in 2024, half of its stated target.',
      tier: 'peerReviewed',
      ageDays: 60,
      independenceKey: 'k-report',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 's-report',
        response: {
          stance: 'contradicts',
          span: 'produced 500,000 units in 2024',
          rationale: 'contradicts the 1M figure',
        },
      },
    ];

    const { verdict } = runPipeline(cl, [src], jr);

    expect(verdict.status).toBe('CONFLICTED');
    expect(verdict.glyph).toBe('!');
    expect(verdict.glyphMeaning).toBe('Conflicted');
    expect(verdict.caps).toContain('strong_contradiction');
    expect(verdict.penalty).toBe(15);
    if (verdict.score !== null) {
      expect(verdict.score).toBeLessThanOrEqual(69);
    }
    expect(verdict.concordance).toEqual({
      supports: 0,
      contradicts: 1,
      neutral: 0,
    });
    expect(verdict.evidenceStrength).toBe('weak');
    expect(verdict.wouldStrengthen.join(' ').toLowerCase()).toContain(
      'contradiction',
    );
  });

  // ---------------------------------------------------------------------------
  // Case 4 — fabricated quote: source exists, judge proposes a fake quote
  // → UNVERIFIED, glyph ?, cap ≤ 40, quote dropped (quote: null)
  // ---------------------------------------------------------------------------
  it('T-06.4 fabricated quote → UNVERIFIED, glyph ?, score ≤ 40, quote is null', () => {
    const cl = claim({
      claimId: 't06-fake',
      text: 'The battery lasts 12 hours.',
      volatility: 'fast',
      halfLifeDays: 30,
    });
    const src = source({
      id: 's-batt',
      pageText:
        'The battery lasts 12 hours under normal use and 8 hours under heavy load.',
      tier: 'primary',
      ageDays: 5,
      independenceKey: 'k-batt',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 's-batt',
        response: {
          stance: 'supports',
          span: 'The battery lasts 24 hours and never needs charging',
          rationale: 'completely fabricated span',
        },
      },
    ];

    const { verdict } = runPipeline(cl, [src], jr);

    expect(verdict.status).toBe('UNVERIFIED');
    expect(verdict.glyph).toBe('?');
    expect(verdict.caps).toContain('quote_failed');
    if (verdict.score !== null) {
      expect(verdict.score).toBeLessThanOrEqual(40);
    }
    // PRD 8.4 step 4: a fabricated quote is NEVER stored or shown.
    expect(verdict.evidence.length).toBe(1);
    expect(verdict.evidence[0].quoteVerified).toBe(false);
    expect(verdict.evidence[0].quote).toBeNull();
    expect(verdict.evidence[0].matchKind).toMatch(
      /paraphrase|not_found|too_long/,
    );
    // Evidence is dropped from concordance (verified-only)
    expect(verdict.concordance.supports).toBe(0);
    expect(verdict.concordance.neutral).toBe(1);
    expect(verdict.evidenceStrength).toBe('weak');
    expect(verdict.wouldStrengthen.join(' ').toLowerCase()).toContain(
      'citation',
    );
  });

  // ---------------------------------------------------------------------------
  // Case 5 — recall only: checked=false → RECALL_ONLY, glyph -, no score
  // ---------------------------------------------------------------------------
  it('T-06.5 recall only → RECALL_ONLY, glyph -, score null', () => {
    const cl = claim({
      claimId: 't06-recall',
      text: 'The quarterly results were positive.',
      checked: false,
      volatility: 'fast',
    });

    const { verdict } = runPipeline(cl, [], []);

    expect(verdict.status).toBe('RECALL_ONLY');
    expect(verdict.glyph).toBe('-');
    expect(verdict.glyphMeaning).toBe('Recall-only');
    expect(verdict.score).toBeNull();
    expect(verdict.caps).toEqual(['not_checked']);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.concordance).toEqual({
      supports: 0,
      contradicts: 0,
      neutral: 0,
    });
    expect(verdict.evidenceStrength).toBe('none');
    expect(verdict.wouldStrengthen.length).toBeGreaterThan(0);
    expect(verdict.wouldStrengthen.join(' ').toLowerCase()).toContain(
      'not checked',
    );
  });
});

// =============================================================================
// Gate: 0 fabricated quotes
// =============================================================================

describe('T-03 integration — 0 fabricated quotes in the pipeline', () => {
  it('a fabricated span never appears in evidence[].quote', () => {
    const cl = claim({
      claimId: 'fabricate-check',
      text: 'The Eiffel Tower is 500 metres tall.',
      volatility: 'stable',
    });
    const src = source({
      pageText: 'The Eiffel Tower is 330 metres tall.',
      tier: 'primary',
      ageDays: 10,
      independenceKey: 'k-eiffel',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 's1',
        response: {
          stance: 'supports',
          span: 'The Eiffel Tower is 500 metres tall',
          rationale: 'made up',
        },
      },
    ];

    const { verdict } = runPipeline(cl, [src], jr);

    for (const e of verdict.evidence) {
      if (!e.quoteVerified) {
        expect(e.quote).toBeNull();
      } else {
        // If verified, the quote must actually be in the page
        expect(src.pageText.includes(e.quote as string)).toBe(true);
      }
    }
  });

  it('three fabricated spans → zero displayed quotes, cap ≤ 40', () => {
    const cl = claim({
      claimId: 'multi-fake',
      text: 'The claim with three fake citations.',
      volatility: 'stable',
    });
    const src1 = source({
      id: 'sa',
      pageText: 'Real page A content here.',
      tier: 'primary',
      independenceKey: 'ka',
    });
    const src2 = source({
      id: 'sb',
      pageText: 'Real page B content here.',
      tier: 'peerReviewed',
      independenceKey: 'kb',
    });
    const src3 = source({
      id: 'sc',
      pageText: 'Real page C content here.',
      tier: 'reputable',
      independenceKey: 'kc',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 'sa',
        response: { stance: 'supports', span: 'FAKE QUOTE A', rationale: '' },
      },
      {
        sourceId: 'sb',
        response: { stance: 'supports', span: 'FAKE QUOTE B', rationale: '' },
      },
      {
        sourceId: 'sc',
        response: { stance: 'supports', span: 'FAKE QUOTE C', rationale: '' },
      },
    ];

    const { verdict } = runPipeline(cl, [src1, src2, src3], jr);

    // All three quotes dropped
    for (const e of verdict.evidence) {
      expect(e.quoteVerified).toBe(false);
      expect(e.quote).toBeNull();
    }
    // quote_failed cap applied
    expect(verdict.caps).toContain('quote_failed');
    if (verdict.score !== null) {
      expect(verdict.score).toBeLessThanOrEqual(40);
    }
    expect(verdict.status).toBe('UNVERIFIED');
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('Edge cases', () => {
  it('not checkable → NOT_SCORED, glyph "", no evidence', () => {
    const cl = claim({
      claimId: 'edge-opinion',
      text: 'Chocolate ice cream is the best flavour.',
      checkable: false,
    });
    const { verdict } = runPipeline(cl, [], []);
    expect(verdict.status).toBe('NOT_SCORED');
    expect(verdict.glyph).toBe('');
    expect(verdict.score).toBeNull();
    expect(verdict.caps).toEqual(['not_checkable']);
    expect(verdict.wouldStrengthen.length).toBeGreaterThan(0);
  });

  it('partial check: source exists, no judge ran → partialCheck true', () => {
    const cl = claim({
      claimId: 'edge-partial',
      text: 'A claim with a source but no judge.',
      volatility: 'stable',
    });
    const src = source({
      pageText: 'The claim is really about something.',
      tier: 'primary',
      ageDays: 5,
      independenceKey: 'kp',
    });
    const { verdict } = runPipeline(cl, [src], []);
    // Source counts for S factor, but no E, no A
    expect(verdict.partialCheck).toBe(true);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.concordance).toEqual({
      supports: 0,
      contradicts: 0,
      neutral: 0,
    });
    expect(verdict.evidenceStrength).toBe('none');
  });

  it('orphaned judge call (source not in sources[]) → ignored, no crash', () => {
    const cl = claim({ claimId: 'edge-orphan' });
    const src = source({ id: 'sa' });
    const jr: JudgeCall[] = [
      {
        sourceId: 'sb-missing',
        response: { stance: 'supports', span: 'x', rationale: '' },
      },
    ];
    const { verdict } = runPipeline(cl, [src], jr);
    // Orphan ignored: evidence stays empty
    expect(verdict.evidence.length).toBe(0);
  });

  it('two independent supports → strong evidenceStrength', () => {
    const cl = claim({
      claimId: 'edge-two-supports',
      text: 'Water boils at 100 degrees Celsius at sea level.',
      volatility: 'stable',
    });
    const src1 = source({
      id: 'sa',
      pageText: 'Water boils at 100 degrees Celsius at sea level.',
      tier: 'primary',
      independenceKey: 'ka',
    });
    const src2 = source({
      id: 'sb',
      pageText: 'At sea level, water boils at 100 degrees Celsius.',
      tier: 'peerReviewed',
      independenceKey: 'kb',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 'sa',
        response: {
          stance: 'supports',
          span: 'Water boils at 100 degrees Celsius at sea level.',
          rationale: '',
        },
      },
      {
        sourceId: 'sb',
        response: {
          stance: 'supports',
          span: 'water boils at 100 degrees Celsius',
          rationale: '',
        },
      },
    ];
    const { verdict } = runPipeline(cl, [src1, src2], jr);
    expect(verdict.concordance.supports).toBe(2);
    expect(verdict.evidenceStrength).toBe('strong');
    expect(verdict.status).toBe('VERIFIED');
  });

  it('weak contradiction (interested-tier source) → MIXED-ish, not CONFLICTED', () => {
    const cl = claim({
      claimId: 'edge-weak-contra',
      text: 'The product ships in Q3 2027.',
      volatility: 'stable',
    });
    const src = source({
      id: 's-interested',
      pageText: 'The product ships in Q4 2027.',
      tier: 'interested', // tier value 50 < 75 → weak contradiction
      independenceKey: 'ki',
    });
    const jr: JudgeCall[] = [
      {
        sourceId: 's-interested',
        response: {
          stance: 'contradicts',
          span: 'The product ships in Q4 2027.',
          rationale: '',
        },
      },
    ];
    const { verdict } = runPipeline(cl, [src], jr);
    // Weak contradiction: cap NOT triggered (only strong does)
    expect(verdict.caps).not.toContain('strong_contradiction');
    expect(verdict.status).not.toBe('CONFLICTED');
    expect(verdict.penalty).toBe(6); // weak contradiction penalty
  });

  it('empty judge span → matchKind=empty, no fake quote', () => {
    const cl = claim({ claimId: 'edge-empty-span' });
    const src = source({ pageText: 'Real page content.' });
    const jr: JudgeCall[] = [
      {
        sourceId: 's1',
        response: { stance: 'neutral', span: '', rationale: 'no evidence' },
      },
    ];
    const { verdict } = runPipeline(cl, [src], jr);
    expect(verdict.evidence.length).toBe(1);
    expect(verdict.evidence[0].matchKind).toBe('empty');
    expect(verdict.evidence[0].quoteVerified).toBe(false);
    expect(verdict.evidence[0].quote).toBeNull();
  });
});

// =============================================================================
// buildVerdict — direct API (no trace)
// =============================================================================

describe('buildVerdict — direct call', () => {
  it('returns a ClaimVerdict without trace (trace is a runPipeline concern)', () => {
    const cl = claim({ claimId: 'direct' });
    const src = source({ pageText: 'Default page text.' });
    const jr: JudgeCall[] = [
      {
        sourceId: 's1',
        response: { stance: 'supports', span: 'Default page text.', rationale: '' },
      },
    ];
    const v = buildVerdict(cl, [src], jr);
    expect(v.claimId).toBe('direct');
    expect(v.claimText).toBe('Default claim text.');
    expect(v.glyph).toBeDefined();
    expect(v.concordance).toBeDefined();
    expect(v.evidenceStrength).toBeDefined();
  });
});
// === FILE END ===