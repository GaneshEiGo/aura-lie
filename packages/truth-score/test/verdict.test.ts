// === FILE START ===
// packages/truth-score/test/verdict.test.ts
// PRD 5.6 · 8.8 · F-035 · F-036.
//
// Every glyph, every meaning, every cap-to-advice mapping.
// concordance and evidenceStrength invariants.
// wouldStrengthen is never empty.

import { describe, it, expect } from 'vitest';
import {
  determineGlyph,
  glyphMeaning,
  getWouldStrengthen,
  computeConcordance,
  computeEvidenceStrength,
  type Evidence,
  type Glyph,
} from '../src/verdict.js';
import type { ClaimStatus } from '../src/types.js';

// -----------------------------------------------------------------------------
// Fixture helper
// -----------------------------------------------------------------------------

function mkEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-test',
    sourceId: 'src-test',
    sourceTitle: 'test source',
    sourceUrl: 'https://example.com',
    sourceTier: 'primary',
    stance: 'supports',
    quote: 'some quote',
    quoteVerified: true,
    matchKind: 'exact',
    retrievedAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// determineGlyph — every PRD 5.6 status maps to the right glyph
// -----------------------------------------------------------------------------

describe('determineGlyph — PRD 5.6', () => {
  const cases: Array<[ClaimStatus, number | null, Glyph]> = [
    ['VERIFIED', 92, '◆'],
    ['VERIFIED', 85, '◆'],
    ['VERIFIED', 100, '◆'],
    ['SUPPORTED', 75, '◇'],
    ['SUPPORTED', 84, '◇'],
    ['SUPPORTED', 70, '◇'],
    ['MIXED', 55, '△'],
    ['MIXED', 69, '△'],
    ['MIXED', 50, '△'],
    ['WEAK', 49, '△'],
    ['WEAK', 0, '△'],
    ['CONFLICTED', 48, '!'],
    ['CONFLICTED', 69, '!'],
    ['UNVERIFIED', null, '?'],
    ['RECALL_ONLY', null, '-'],
    ['NOT_SCORED', null, ''],
  ];

  for (const [status, score, expected] of cases) {
    it(`${status} (score=${score === null ? 'null' : score}) → '${expected || '(empty)'}'`, () => {
      expect(determineGlyph(status, score)).toBe(expected);
    });
  }

  it('CONFLICTED always uses ! regardless of score', () => {
    expect(determineGlyph('CONFLICTED', 0)).toBe('!');
    expect(determineGlyph('CONFLICTED', 69)).toBe('!');
    expect(determineGlyph('CONFLICTED', null)).toBe('!');
  });

  it('UNVERIFIED always uses ? regardless of score', () => {
    expect(determineGlyph('UNVERIFIED', 0)).toBe('?');
    expect(determineGlyph('UNVERIFIED', 40)).toBe('?');
    expect(determineGlyph('UNVERIFIED', null)).toBe('?');
  });
});

// -----------------------------------------------------------------------------
// glyphMeaning — every glyph has a human word
// -----------------------------------------------------------------------------

describe('glyphMeaning', () => {
  it('every glyph has a non-empty meaning', () => {
    const glyphs: Glyph[] = ['◆', '◇', '△', '!', '?', '-', ''];
    for (const g of glyphs) {
      const meaning = glyphMeaning(g);
      expect(typeof meaning).toBe('string');
      // Empty glyph returns empty meaning (NOT_SCORED is hidden)
      if (g === '') {
        expect(meaning).toBe('Not scored');
      } else {
        expect(meaning.length).toBeGreaterThan(0);
      }
    }
  });

  it('exact word for each glyph (PRD 5.6)', () => {
    expect(glyphMeaning('◆')).toBe('Verified');
    expect(glyphMeaning('◇')).toBe('Supported');
    expect(glyphMeaning('△')).toBe('Mixed');
    expect(glyphMeaning('!')).toBe('Conflicted');
    expect(glyphMeaning('?')).toBe('Unverified');
    expect(glyphMeaning('-')).toBe('Recall-only');
  });
});

// -----------------------------------------------------------------------------
// getWouldStrengthen — always non-empty, every cap addressed
// -----------------------------------------------------------------------------

describe('getWouldStrengthen', () => {
  it('no_source → advice about adding a source', () => {
    const a = getWouldStrengthen(['no_source'], 0);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('source');
  });

  it('quote_failed → advice about the citation', () => {
    const a = getWouldStrengthen(['quote_failed'], 40);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('citation');
  });

  it('interested_only → advice about non-interested source', () => {
    const a = getWouldStrengthen(['interested_only'], 60);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('non-interested');
  });

  it('strong_contradiction → advice about resolving the contradiction', () => {
    const a = getWouldStrengthen(['strong_contradiction'], 48);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('contradiction');
  });

  it('stale → advice about finding a more recent source', () => {
    const a = getWouldStrengthen(['stale'], 55);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('recent');
  });

  it('multiple caps → multiple advices', () => {
    const a = getWouldStrengthen(['no_source', 'stale'], 0);
    expect(a.length).toBeGreaterThanOrEqual(2);
  });

  it('no caps + score 92 → "already strong" advice', () => {
    const a = getWouldStrengthen([], 92);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toMatch(/already strong|primary source/);
  });

  it('no caps + score 75 → advice about raising confidence', () => {
    const a = getWouldStrengthen([], 75);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('confidence');
  });

  it('no caps + score 55 → advice about thin evidence', () => {
    const a = getWouldStrengthen([], 55);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('evidence');
  });

  it('no caps + score 30 → advice about finding a primary source', () => {
    const a = getWouldStrengthen([], 30);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('primary');
  });

  it('no caps + score null → advice about verifying', () => {
    const a = getWouldStrengthen([], null);
    expect(a.length).toBeGreaterThan(0);
    expect(a.join(' ').toLowerCase()).toContain('verify');
  });

  it('ALWAYS returns a non-empty array (never empty)', () => {
    const inputs: Array<[string[], number | null]> = [
      [[], null],
      [[], 0],
      [[], 30],
      [[], 55],
      [[], 75],
      [[], 92],
      [['no_source'], 0],
      [['unknown_cap'], 50], // unknown cap still returns a fallback
    ];
    for (const [caps, score] of inputs) {
      const a = getWouldStrengthen(caps, score);
      expect(a.length).toBeGreaterThan(0);
    }
  });
});

// -----------------------------------------------------------------------------
// computeConcordance — verified-only counting
// -----------------------------------------------------------------------------

describe('computeConcordance', () => {
  it('empty evidence → 0/0/0', () => {
    const c = computeConcordance([]);
    expect(c).toEqual({ supports: 0, contradicts: 0, neutral: 0 });
  });

  it('verified supports counted, unverified supports NOT counted', () => {
    const c = computeConcordance([
      mkEvidence({ stance: 'supports', quoteVerified: true }),
      mkEvidence({ stance: 'supports', quoteVerified: false }),
    ]);
    expect(c.supports).toBe(1);
    expect(c.contradicts).toBe(0);
  });

  it('verified contradicts counted, unverified contradicts NOT counted', () => {
    const c = computeConcordance([
      mkEvidence({ stance: 'contradicts', quoteVerified: true }),
      mkEvidence({ stance: 'contradicts', quoteVerified: false }),
    ]);
    expect(c.contradicts).toBe(1);
    expect(c.supports).toBe(0);
  });

  it('neural stance counts regardless of verification', () => {
    const c = computeConcordance([
      mkEvidence({ stance: 'neutral', quoteVerified: false }),
      mkEvidence({ stance: 'neutral', quoteVerified: true }),
    ]);
    expect(c.neutral).toBe(2);
  });

  it('mixed stances counted correctly', () => {
    const c = computeConcordance([
      mkEvidence({ stance: 'supports', quoteVerified: true }),
      mkEvidence({ stance: 'supports', quoteVerified: true }),
      mkEvidence({ stance: 'contradicts', quoteVerified: true }),
      mkEvidence({ stance: 'neutral', quoteVerified: false }),
    ]);
    expect(c).toEqual({ supports: 2, contradicts: 1, neutral: 1 });
  });
});

// -----------------------------------------------------------------------------
// computeEvidenceStrength
// -----------------------------------------------------------------------------

describe('computeEvidenceStrength', () => {
  it('none — total = 0', () => {
    expect(
      computeEvidenceStrength({ supports: 0, contradicts: 0, neutral: 0 }),
    ).toBe('none');
  });

  it('strong — ≥2 verified supports, no contradictions', () => {
    expect(
      computeEvidenceStrength({ supports: 2, contradicts: 0, neutral: 0 }),
    ).toBe('strong');
    expect(
      computeEvidenceStrength({ supports: 3, contradicts: 0, neutral: 0 }),
    ).toBe('strong');
  });

  it('moderate — exactly 1 verified support, no contradiction', () => {
    expect(
      computeEvidenceStrength({ supports: 1, contradicts: 0, neutral: 0 }),
    ).toBe('moderate');
  });

  it('weak — any verified contradiction (PRD 8.7)', () => {
    expect(
      computeEvidenceStrength({ supports: 2, contradicts: 1, neutral: 0 }),
    ).toBe('weak');
    expect(
      computeEvidenceStrength({ supports: 0, contradicts: 1, neutral: 0 }),
    ).toBe('weak');
  });

  it('weak — only neutral evidence', () => {
    expect(
      computeEvidenceStrength({ supports: 0, contradicts: 0, neutral: 3 }),
    ).toBe('weak');
  });
});
// === FILE END ===