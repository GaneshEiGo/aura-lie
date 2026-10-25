// === FILE START ===
// packages/truth-score/src/verdict.ts
// PRD 8.2 · 8.8 · 5.6 · F-035 · F-036 · Section 82 conflict extension.

import type { ClaimStatus, SourceTier } from './types.js';
import type { QuoteMatchKind } from './quote-span.js';
import type { ConflictAnalysis } from './conflict.js';
import type { ConflictAnalysis } from './conflict.js'; // NEW (Section 82)

// -----------------------------------------------------------------------------
// Glyphs and meanings (PRD 5.6 · 8.8)
// -----------------------------------------------------------------------------

export type Glyph = '◆' | '◇' | '△' | '!' | '?' | '-' | '';

export function determineGlyph(status: ClaimStatus, score: number | null): Glyph {
  if (status === 'CONFLICTED') return '!';
  if (status === 'UNVERIFIED') return '?';
  if (status === 'RECALL_ONLY') return '-';
  if (status === 'NOT_SCORED') return '';
  if (status === 'VERIFIED') return '◆';
  if (status === 'SUPPORTED') return '◇';
  if (status === 'MIXED' || status === 'WEAK') return '△';
  return score !== null && score >= 85 ? '◆' : '△';
}

export function glyphMeaning(glyph: Glyph): string {
  switch (glyph) {
    case '◆': return 'Verified';
    case '◇': return 'Supported';
    case '△': return 'Mixed';
    case '!': return 'Conflicted';
    case '?': return 'Unverified';
    case '-': return 'Recall-only';
    case '': return 'Not scored';
    default: return '';
  }
}

// -----------------------------------------------------------------------------
// Evidence (PRD 8.2 · 8.4 step 4)
// -----------------------------------------------------------------------------

export interface Evidence {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceTier: SourceTier;
  stance: 'supports' | 'contradicts' | 'neutral';
  quote: string | null;
  quoteVerified: boolean;
  matchKind: QuoteMatchKind | null;
  retrievedAt: string;
}

// -----------------------------------------------------------------------------
// Concordance + evidence strength
// -----------------------------------------------------------------------------

export interface Concordance {
  supports: number;
  contradicts: number;
  neutral: number;
}

export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'none';

export function computeConcordance(evidence: Evidence[]): Concordance {
  let supports = 0;
  let contradicts = 0;
  let neutral = 0;
  for (const e of evidence) {
    if (e.stance === 'supports' && e.quoteVerified) supports++;
    else if (e.stance === 'contradicts' && e.quoteVerified) contradicts++;
    else neutral++;
  }
  return { supports, contradicts, neutral };
}

export function computeEvidenceStrength(c: Concordance): EvidenceStrength {
  const total = c.supports + c.contradicts + c.neutral;
  if (total === 0) return 'none';
  if (c.contradicts > 0) return 'weak';
  if (c.supports >= 2) return 'strong';
  if (c.supports === 1) return 'moderate';
  return 'weak';
}

// -----------------------------------------------------------------------------
// "What would make this stronger" (PRD 5.6)
// -----------------------------------------------------------------------------

const CAP_ADVICE: Record<string, string> = {
  no_source: 'Add an independent source for this claim.',
  quote_failed:
    'Re-check the citation. The quote did not appear in the source page.',
  interested_only:
    'Find a non-interested source (e.g. an official or peer-reviewed one).',
  strong_contradiction:
    'Resolve the contradiction. Two sources disagree on this claim.',
  stale:
    'Find a more recent source. This claim is older than two half-lives.',
  not_checkable:
    'This is an opinion or creative statement. Nothing to verify.',
  not_checked:
    'This claim was not checked (usually because search quota is low).',
};

export function getWouldStrengthen(
  caps: string[],
  score: number | null,
): string[] {
  if (caps.length > 0) {
    const out: string[] = [];
    for (const cap of caps) {
      const advice = CAP_ADVICE[cap];
      if (advice) out.push(advice);
    }
    if (out.length > 0) return out;
  }
  if (score === null) {
    return ['Verify this claim when quota allows.'];
  }
  if (score >= 85) {
    return [
      'Already strong. Adding one more primary source would make it bulletproof.',
    ];
  }
  if (score >= 70) {
    return ['Add an independent source to raise confidence into the 85+ band.'];
  }
  if (score >= 50) {
    return [
      'Verify with an additional source. The current evidence is thin.',
    ];
  }
  return [
    'Look for a primary source that directly addresses this claim.',
  ];
}

// -----------------------------------------------------------------------------
// The ClaimVerdict — the shape the Fact drawer consumes
// -----------------------------------------------------------------------------

export interface ClaimVerdict {
  claimId: string;
  claimText: string;
  status: ClaimStatus;
  score: number | null;
  evidence: Evidence[];
  caps: string[];
  penalty: number;
  partialCheck: boolean;
  wouldStrengthen: string[];
  glyph: Glyph;
  glyphMeaning: string;
  concordance: Concordance;
  evidenceStrength: EvidenceStrength;
  conflictAnalysis?: ConflictAnalysis | null;
  /** NEW (Section 82): populated only when status === 'CONFLICTED'. */
  conflictAnalysis?: ConflictAnalysis | null;
}
// === FILE END ===