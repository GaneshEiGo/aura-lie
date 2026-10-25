// packages/truth/src/score.ts
// PRD 8.7 scoring + PRD 5.6 response-level summary.
// Handles every field name the pipeline, adapters, and test suite use.

import type {
  ClaimImportance,
  ClaimStatus,
  ClaimBand,
  ScoredClaim,
  ScoreFactors,
  ResponseSummary,
} from './types.js';
import {
  WEIGHTS,
  C_RENORMALIZED_TOTAL,
  BAND_THRESHOLDS,
  HARD_CAPS,
  PENALTIES,
  WEAKEST_CRITICAL_MARGIN,
} from './weights.js';

// ---------------------------------------------------------------------------
// Raw score (renormalised when C is excluded)
// ---------------------------------------------------------------------------

export function calculateRawScore(factors: ScoreFactors): number {
  const S = numOrZero(factors?.S);
  const E = numOrZero(factors?.E);
  const A = numOrZero(factors?.A);
  const F = numOrZero(factors?.F);
  const hasC = factors?.C !== undefined && factors?.C !== null;
  const C = hasC ? numOrZero(factors!.C) : 0;

  const totalWeight = hasC ? 1.0 : C_RENORMALIZED_TOTAL;
  const raw =
    WEIGHTS.S * S +
    WEIGHTS.E * E +
    WEIGHTS.A * A +
    WEIGHTS.F * F +
    WEIGHTS.C * C;

  return raw / totalWeight;
}

// ---------------------------------------------------------------------------
// Single-claim scoring
// ---------------------------------------------------------------------------

export function scoreClaim(claim: any): ScoredClaim {
  if (!claim || typeof claim !== 'object') {
    return {
      score: 0,
      status: 'UNVERIFIED',
      band: 'recall-only',
      capsApplied: [],
    };
  }

  const factors =
    claim.factors && typeof claim.factors === 'object' ? claim.factors : claim;

  const merged = { ...factors, ...claim };

  const S = pickNumber(merged, ['S', 'sourceSupport', 'source_support', 'sourceSupportScore']);
  const E = pickNumber(merged, ['E', 'entailment', 'entailmentScore']);
  const A = pickNumber(merged, ['A', 'agreement', 'agreementScore', 'judgeAgreement']);
  const F = pickNumber(merged, ['F', 'freshness', 'freshnessScore']);
  const CMaybe = pickOptionalNumber(merged, ['C', 'consistency', 'consistencyScore']);

  let score = calculateRawScore({ S, E, A, F, C: CMaybe });
  const capsApplied: string[] = [];

  // -- contradiction penalty -------------------------------------------------
  // Accepts an explicit number OR a boolean flag that implies the standard 15.
  let penalty = pickNumber(merged, [
    'contradictionPenalty',
    'contradiction_penalty',
    'contradictionPenaltyPoints',
    'penalty',
    'penalties',
  ]);

  const strongFlag =
    merged.hasStrongContradiction === true ||
    merged.has_strong_contradiction === true ||
    merged.strongContradiction === true ||
    merged.strong_contradiction === true;

  if (strongFlag && penalty < PENALTIES.STRONG_CONTRADICTION) {
    penalty = PENALTIES.STRONG_CONTRADICTION;
  }

  if (penalty > 0) {
    score -= penalty;
  }

  // -- quote match failure ---------------------------------------------------
  // `isQuoteVerified: false` is the inverse phrasing used by the test suite.
  const quoteFailed =
    pickBooleanTrue(merged, [
      'quoteMatchFailed',
      'quote_match_failed',
      'quoteInvalid',
      'quote_invalid',
    ]) ||
    pickBooleanFalse(merged, [
      'quoteMatch',
      'quote_match',
      'quoteValid',
      'quote_valid',
      'matchOk',
      'match_ok',
      'isQuoteVerified',
      'is_quote_verified',
    ]);

  if (quoteFailed) {
    score = Math.min(score, HARD_CAPS.QUOTE_FAIL);
    capsApplied.push(`Quote match failed (max ${HARD_CAPS.QUOTE_FAIL})`);
  }

  // -- interested party ------------------------------------------------------
  const isInterested = pickBooleanTrue(merged, [
    'isInterestedParty',
    'interested_party',
    'interestedParty',
  ]);
  if (isInterested) {
    score = Math.min(score, HARD_CAPS.INTERESTED_PARTY);
    capsApplied.push(`Interested party only (max ${HARD_CAPS.INTERESTED_PARTY})`);
  }

  // -- no source found (PRD 8.7 floor) ---------------------------------------
  const noSource =
    merged.hasSource === false ||
    merged.has_source === false ||
    merged.sourceAvailable === false ||
    merged.source_available === false;

  if (noSource) {
    score = Math.min(score, HARD_CAPS.NO_SOURCE);
    capsApplied.push(`No source found (max ${HARD_CAPS.NO_SOURCE})`);
  }

  // -- strong contradiction cap + message ------------------------------------
  if (penalty >= PENALTIES.STRONG_CONTRADICTION) {
    score = Math.min(score, HARD_CAPS.STRONG_CONTRADICTION);
    capsApplied.push(`Strong contradiction (-${penalty})`);
  }

  score = Math.max(0, Math.round(score));

  let status: ClaimStatus = 'UNVERIFIED';
  let band: ClaimBand = 'recall-only';

  if (penalty >= PENALTIES.STRONG_CONTRADICTION) {
    status = 'CONFLICTED';
    band = 'conflicted';
  } else if (score >= BAND_THRESHOLDS.VERIFIED) {
    status = 'VERIFIED';
    band = 'verified';
  } else if (score >= BAND_THRESHOLDS.SUPPORTED) {
    status = 'SUPPORTED';
    band = 'supported';
  } else if (score >= BAND_THRESHOLDS.MIXED) {
    status = 'MIXED';
    band = 'mixed';
  } else {
    status = 'WEAK';
    band = 'weak';
  }

  const importance = extractImportance(claim) ?? extractImportance(factors);

  return { score, status, band, capsApplied, importance };
}

// ---------------------------------------------------------------------------
// Response-level summary (weakest critical link rule)
// ---------------------------------------------------------------------------

export function summarizeResponse(
  claims: any[],
  checkableCount: number,
): ResponseSummary {
  if (!Array.isArray(claims)) {
    return { overall: null, chip: 'RECALL-ONLY', checked: 0 };
  }

  const checked = claims.filter((c) => computeScore(c) !== null);

  if (checked.length === 0) {
    return { overall: null, chip: 'RECALL-ONLY', checked: 0 };
  }

  const scores = checked.map((c) => computeScore(c) as number);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  const critical = checked.filter(isCriticalClaim);
  const pool = critical.length > 0 ? critical : checked;
  const lowestCritical = Math.min(...pool.map((c) => computeScore(c) as number));

  const overall = Math.round(
    Math.min(mean, lowestCritical + WEAKEST_CRITICAL_MARGIN),
  );

  let chip = 'WEAK';
  if (overall >= BAND_THRESHOLDS.VERIFIED) chip = 'VERIFIED';
  else if (overall >= BAND_THRESHOLDS.SUPPORTED) chip = 'SUPPORTED';
  else if (overall >= BAND_THRESHOLDS.MIXED) chip = 'MIXED';

  const hasConflict = claims.some((c) => {
    if (c?.status === 'CONFLICTED') return true;
    const s = computeScore(c);
    return s !== null && s < BAND_THRESHOLDS.MIXED;
  });
  if (hasConflict) chip = 'CHECK';

  return { overall, chip, checked: checked.length };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function numOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return 0;
}

function pickNumber(obj: Record<string, any> | undefined, keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

function pickOptionalNumber(
  obj: Record<string, any> | undefined,
  keys: string[],
): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

function pickBooleanTrue(obj: Record<string, any> | undefined, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    if (obj[k] === true) return true;
  }
  return false;
}

function pickBooleanFalse(obj: Record<string, any> | undefined, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    if (obj[k] === false) return true;
  }
  return false;
}

/**
 * Resolves a claim's numeric score from ANY of three sources:
 *   1. An explicit `score` / `factScore` / ... field.
 *   2. A nested `claim` or `result` object.
 *   3. Recomputing via `scoreClaim(claim)` when the claim carries factors.
 */
function computeScore(c: any): number | null {
  if (!c) return null;

  const directKeys = [
    'score',
    'factScore',
    'fact_score',
    'value',
    'scored',
    'rating',
    'finalScore',
    'claimScore',
    'overall',
    'fact',
  ];
  for (const k of directKeys) {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }

  if (c.claim && typeof c.claim === 'object') {
    const nested = computeScore(c.claim);
    if (nested !== null) return nested;
  }
  if (c.result && typeof c.result === 'object') {
    const nested = computeScore(c.result);
    if (nested !== null) return nested;
  }

  const looksScoreable =
    c.factors !== undefined ||
    c.S !== undefined ||
    c.E !== undefined ||
    c.A !== undefined ||
    c.F !== undefined ||
    c.sourceSupport !== undefined ||
    c.entailment !== undefined ||
    c.agreement !== undefined ||
    c.freshness !== undefined;

  if (looksScoreable) {
    try {
      const scored = scoreClaim(c);
      if (scored && typeof scored.score === 'number' && Number.isFinite(scored.score)) {
        return scored.score;
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * PRD 8.7: critical = importance >= 0.7 (numeric) OR 'central' (string).
 */
function isCriticalClaim(c: any): boolean {
  if (!c) return false;

  const isCriticalImp = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    const imp = obj.importance;
    if (imp === 'central') return true;
    if (typeof imp === 'number' && imp >= 0.7) return true;
    if (obj.isCritical === true) return true;
    return false;
  };

  if (isCriticalImp(c)) return true;
  if (c.claim && isCriticalImp(c.claim)) return true;
  if (c.factors && isCriticalImp(c.factors)) return true;
  return false;
}

function extractImportance(obj: any): ClaimImportance | undefined {
  if (!obj) return undefined;
  const raw = obj.importance;
  if (raw === 'central' || raw === 'supporting') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 0.7 ? 'central' : 'supporting';
  }
  return undefined;
}