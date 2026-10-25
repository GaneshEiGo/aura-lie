// === FILE START ===
// packages/truth-score/src/conflict.ts
// PRD 8.3 step 7 · 8.6 · FR-TRUTH-11 · F-038.
//
// The Conflict Engine. A deeper layer on top of CONFLICTED status that
// answers the user's question: *why* do these sources disagree, and which
// side should I trust?
//
// 7 cause hypotheses (PRD 8.3 step 7):
//   different_year        — spans reference different 4-digit years
//   different_definition  — spans use different definitions of a term
//   different_method      — spans used different measurement methods
//   updated_figure        — one span reports a revised/newer figure
//   reporting_error       — numeric mismatch with no other explanation
//   different_scope       — spans cover different populations or regions
//   unknown               — cause cannot be inferred (still a real conflict)
//
// Section 82 FIX (this revision):
//   `updated_figure` now fires BEFORE `different_year`. A span that says
//   "updated in 2024" vs "from 2020" is a revision, not a year-scoping
//   conflict — the "updated" keyword is more specific than the year
//   difference and must win. The pure year-conflict case (e.g. "Q3 2027"
//   vs "Q3 2028" with no update keyword) still resolves to
//   `different_year`, which is correct.
//
// Resolution rule (PRD 8.3 step 7):
//   · If one side has a strictly higher-tier source → that side "wins"
//   · If tiers are equal → unresolved, show both to the user
//
// Confidence (0..1) — how sure we are this is a real conflict:
//   · +0.5 base (both sides present and verified)
//   · +0.2 if cause !== 'unknown'
//   · +0.15 if tier resolution succeeded
//   · +0.15 if both sides have at least one verified quote
//
// All analysis is deterministic — no model call, no network.

import type { ClaimVerdict, Evidence } from './verdict.js';
import type { SourceTier } from './types.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type ConflictCause =
  | 'different_year'
  | 'different_definition'
  | 'different_method'
  | 'updated_figure'
  | 'reporting_error'
  | 'different_scope'
  | 'unknown';

export interface ConflictPair {
  supports: Evidence;
  contradicts: Evidence;
  cause: ConflictCause;
  explanation: string;
}

export type ResolutionKind = 'best_tier_wins' | 'unresolved';

export interface ConflictResolution {
  kind: ResolutionKind;
  winner: Evidence | null;
  reason: string;
}

export interface ConflictAnalysis {
  hasConflict: boolean;
  supports: Evidence[];
  contradicts: Evidence[];
  pairs: ConflictPair[];
  cause: ConflictCause;
  resolution: ConflictResolution;
  explanation: string;
  confidence: number;
}

// -----------------------------------------------------------------------------
// Tier ranking (higher = stronger)
// -----------------------------------------------------------------------------

const TIER_RANK: Record<SourceTier, number> = {
  primary: 6,
  peerReviewed: 5,
  reputable: 4,
  interested: 3,
  forum: 2,
  unknown: 1,
};

function maxTierRank(evidence: Evidence[]): number {
  let best = 0;
  for (const e of evidence) {
    const rank = TIER_RANK[e.sourceTier] ?? 1;
    if (rank > best) best = rank;
  }
  return best;
}

// -----------------------------------------------------------------------------
// Cause inference
// -----------------------------------------------------------------------------

function extractYears(text: string): Set<number> {
  const matches = text.match(/\b(?:19|20)\d{2}\b/g);
  if (!matches) return new Set();
  return new Set(matches.map(Number));
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\b\d+(?:[.,]\d+)?\b/g);
  if (!matches) return [];
  return matches.map((s) => Number(s.replace(/,/g, '')));
}

const DEFINITION_KEYWORDS = ['defined as', 'definition', 'refers to', 'means that'];
const METHOD_KEYWORDS = ['measured', 'estimated', 'method', 'sampled', 'calculated'];
const UPDATE_KEYWORDS = ['updated', 'revised', 'latest', 'new version', 'corrected'];
const SCOPE_KEYWORDS = ['region', 'population', 'scope', 'country', 'sample'];

function textContainsAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export function inferCause(
  supportsSpans: string[],
  contradictsSpans: string[],
): ConflictCause {
  const supportsText = supportsSpans.join(' ').toLowerCase();
  const contradictsText = contradictsSpans.join(' ').toLowerCase();

  // 1. Updated figure (Section 82 FIX: checked FIRST because the "updated"
  //    keyword is more specific than a generic year conflict. "Updated in
  //    2024 vs from 2020" is a revision, not a scoping conflict.)
  if (
    textContainsAny(supportsText, UPDATE_KEYWORDS) ||
    textContainsAny(contradictsText, UPDATE_KEYWORDS)
  ) {
    return 'updated_figure';
  }

  // 2. Different definition
  if (
    textContainsAny(supportsText, DEFINITION_KEYWORDS) ||
    textContainsAny(contradictsText, DEFINITION_KEYWORDS)
  ) {
    return 'different_definition';
  }

  // 3. Different method
  if (
    textContainsAny(supportsText, METHOD_KEYWORDS) ||
    textContainsAny(contradictsText, METHOD_KEYWORDS)
  ) {
    return 'different_method';
  }

  // 4. Different year — both sides reference years, no overlap
  const supportYears = new Set<number>();
  const contradictYears = new Set<number>();
  for (const span of supportsSpans) {
    for (const y of extractYears(span)) supportYears.add(y);
  }
  for (const span of contradictsSpans) {
    for (const y of extractYears(span)) contradictYears.add(y);
  }
  if (supportYears.size > 0 && contradictYears.size > 0) {
    let overlap = false;
    for (const y of supportYears) {
      if (contradictYears.has(y)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) return 'different_year';
  }

  // 5. Different scope
  if (
    textContainsAny(supportsText, SCOPE_KEYWORDS) ||
    textContainsAny(contradictsText, SCOPE_KEYWORDS)
  ) {
    return 'different_scope';
  }

  // 6. Reporting error — numeric mismatch, no other explanation
  const supportNumbers = extractNumbers(supportsText);
  const contradictNumbers = extractNumbers(contradictsText);
  if (supportNumbers.length > 0 && contradictNumbers.length > 0) {
    const sSet = new Set(supportNumbers);
    const cSet = new Set(contradictNumbers);
    let allMatch = sSet.size === cSet.size;
    if (allMatch) {
      for (const n of sSet) {
        if (!cSet.has(n)) {
          allMatch = false;
          break;
        }
      }
    }
    if (!allMatch) return 'reporting_error';
  }

  // 7. Unknown
  return 'unknown';
}

// -----------------------------------------------------------------------------
// Explanation text
// -----------------------------------------------------------------------------

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function explainCause(
  cause: ConflictCause,
  supportsQuote: string | null,
  contradictsQuote: string | null,
): string {
  const s = supportsQuote ? truncate(supportsQuote) : '(no quote)';
  const c = contradictsQuote ? truncate(contradictsQuote) : '(no quote)';
  switch (cause) {
    case 'different_year':
      return `Sources disagree because they refer to different years. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'different_definition':
      return `Sources use different definitions of the same term. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'different_method':
      return `Sources used different measurement methods. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'updated_figure':
      return `One source reports a newer figure than the other. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'reporting_error':
      return `Numeric mismatch with no other explanation — likely a reporting error. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'different_scope':
      return `Sources cover different populations or regions. Supports: "${s}" vs Contradicts: "${c}".`;
    case 'unknown':
      return `Sources disagree but the cause could not be inferred. Supports: "${s}" vs Contradicts: "${c}".`;
  }
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

function resolveByTier(
  supports: Evidence[],
  contradicts: Evidence[],
): ConflictResolution {
  const sMax = maxTierRank(supports);
  const cMax = maxTierRank(contradicts);

  if (sMax > cMax) {
    const winner = supports.find((e) => TIER_RANK[e.sourceTier] === sMax) ?? supports[0];
    return {
      kind: 'best_tier_wins',
      winner,
      reason: `Supports side has higher-tier source (tier rank ${sMax} > ${cMax}).`,
    };
  }
  if (cMax > sMax) {
    const winner = contradicts.find((e) => TIER_RANK[e.sourceTier] === cMax) ?? contradicts[0];
    return {
      kind: 'best_tier_wins',
      winner,
      reason: `Contradicts side has higher-tier source (tier rank ${cMax} > ${sMax}).`,
    };
  }
  return {
    kind: 'unresolved',
    winner: null,
    reason: `Both sides have equal-tier sources (rank ${sMax}). Show both to the user.`,
  };
}

// -----------------------------------------------------------------------------
// Public analysis function
// -----------------------------------------------------------------------------

export function analyzeConflicts(verdict: ClaimVerdict): ConflictAnalysis {
  const supports = verdict.evidence.filter(
    (e) => e.stance === 'supports' && e.quoteVerified,
  );
  const contradicts = verdict.evidence.filter(
    (e) => e.stance === 'contradicts' && e.quoteVerified,
  );

  const hasConflict = supports.length > 0 && contradicts.length > 0;

  if (!hasConflict) {
    return {
      hasConflict: false,
      supports,
      contradicts,
      pairs: [],
      cause: 'unknown',
      resolution: {
        kind: 'unresolved',
        winner: null,
        reason: 'No verified contradiction found.',
      },
      explanation: 'No verified contradiction found.',
      confidence: 0,
    };
  }

  const supportsSpans = supports
    .map((e) => e.quote)
    .filter((q): q is string => q !== null);
  const contradictsSpans = contradicts
    .map((e) => e.quote)
    .filter((q): q is string => q !== null);

  const cause = inferCause(supportsSpans, contradictsSpans);

  // Build pairs (cap at 5 to bound memory)
  const pairs: ConflictPair[] = [];
  outer: for (const s of supports) {
    for (const c of contradicts) {
      if (pairs.length >= 5) break outer;
      pairs.push({
        supports: s,
        contradicts: c,
        cause,
        explanation: explainCause(cause, s.quote, c.quote),
      });
    }
  }

  const resolution = resolveByTier(supports, contradicts);

  let confidence = 0.5;
  if (cause !== 'unknown') confidence += 0.2;
  if (resolution.kind === 'best_tier_wins') confidence += 0.15;
  if (supports.length > 0 && contradicts.length > 0) confidence += 0.15;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    hasConflict: true,
    supports,
    contradicts,
    pairs,
    cause,
    resolution,
    explanation: explainCause(cause, supports[0].quote, contradicts[0].quote),
    confidence,
  };
}
// === FILE END ===