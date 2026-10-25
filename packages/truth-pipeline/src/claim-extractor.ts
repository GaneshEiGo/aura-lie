// packages/truth-pipeline/src/claim-extractor.ts
// PRD 8.3 step 1: EXTRACT atomic, check-worthy claims.
// Rule-based, deterministic for W1 tests; a model-backed extractor can
// swap in later behind the same interface.

import type { ClaimType, ExtractedClaim, Volatility } from './types.js';

const DATE_RE =
  /\b(19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

const NUMERIC_RE =
  /\b\d+(?:\.\d+)?\s*(?:%|percent|kg|g|mg|lb|km|m|cm|mm|mi|ft|in|ms|s|min|hr|h|day|days|year|years|inr|usd|eur|gbp|rupees?|dollars?)?\b/i;

const DEFINITION_RE =
  /\b(?:is|are|means|refers\s+to|is\s+defined\s+as|describes)\b/i;

const CAUSAL_RE =
  /\b(?:because|due\s+to|leads?\s+to|causes?|results?\s+in|as\s+a\s+result|therefore|thus|hence)\b/i;

/**
 * Comparator signal. `-er than` (e.g. "faster than", "stronger than") is
 * the most common comparison in practice, so it gets both explicit keywords
 * AND a generic `\w+er\s+than` fallback. Also covers "-est" superlatives
 * phrased as comparisons ("the fastest of").
 */
const COMPARISON_RE =
  /\b(?:more\s+than|less\s+than|greater\s+than|fewer|higher|lower|better|worse|faster|slower|stronger|weaker|cheaper|larger|smaller|older|younger|newer|earlier|later|equal\s+to|compared\s+to|compared\s+with|vs\.?|versus|\w{3,}er\s+than)\b/i;

const FORECAST_RE =
  /\b(?:will|shall|predict|forecast|expect(?:ed)?|project(?:ed)?|by\s+(?:19|20)\d{2})\b/i;

const OPINION_RE =
  /\b(?:I\s+(?:think|feel|believe)|in\s+my\s+opinion|I\s+prefer)\b/i;

export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function classifyType(sentence: string): ClaimType {
  if (OPINION_RE.test(sentence)) return 'opinion';
  if (FORECAST_RE.test(sentence)) return 'forecast';
  if (DATE_RE.test(sentence)) return 'date';
  if (NUMERIC_RE.test(sentence)) return 'numeric';
  if (COMPARISON_RE.test(sentence)) return 'comparison';
  if (CAUSAL_RE.test(sentence)) return 'causal';
  if (DEFINITION_RE.test(sentence)) return 'definition';
  return 'entity-relation';
}

export function inferVolatility(
  sentence: string,
  type: ClaimType,
): Volatility {
  if (type === 'date' || type === 'numeric' || type === 'forecast') {
    return 'fast';
  }
  if (
    /\b(?:prices?|stock|weather|news|today|tomorrow|yesterday|currently)\b/i.test(
      sentence,
    )
  ) {
    return 'fast';
  }
  if (type === 'definition') return 'stable';
  return 'slow';
}

export function extractClaims(
  text: string,
  maxClaims: number,
): ExtractedClaim[] {
  if (!text || typeof text !== 'string') return [];
  if (!Number.isFinite(maxClaims) || maxClaims <= 0) return [];

  const sentences = splitSentences(text);
  const claims: ExtractedClaim[] = [];

  for (const sentence of sentences) {
    if (claims.length >= maxClaims) break;
    if (sentence.length < 10) continue;

    const type = classifyType(sentence);
    if (type === 'opinion') continue;

    const importance = claims.length === 0 ? 'central' : 'supporting';
    const importanceScore = claims.length === 0 ? 1.0 : 0.5;
    const volatility = inferVolatility(sentence, type);

    claims.push({
      id: `claim-${claims.length + 1}`,
      text: sentence,
      type,
      importance,
      importanceScore,
      volatility,
    });
  }

  return claims;
}