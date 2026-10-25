// === FILE START ===
// packages/claim-extract/src/classify.ts
// PRD 8.3 step 2 · FR-TRUTH-02.
//
// Type priority (first match wins). Order matters: an opinion like
// "I believe X will happen" must be classified as opinion, not forecast.
//
//   1. opinion     — "I think", "I believe", "in my opinion", "personally"
//   2. forecast    — "will X", "going to X", "predict", "by 20XX"
//   3. causal      — "because", "due to", "caused by", "as a result of"
//   4. comparison  — "more", "larger", "than", "the largest"
//   5. definition  — "is a X", "is an X", "formula for", "symbol for", "means"
//   6. date        — year (19XX/20XX) or month-name + year
//   7. numeric     — any digit or % / $ / ₹
//   8. entity-relation — default

import type { ClaimClassification, ClaimType, ClaimVolatility } from './types.js';

const OPINION_RE =
  /\b(?:i\s+(?:think|believe|feel|reckon)|in\s+my\s+opinion|personally|if\s+you\s+ask\s+me|imo|imho)\b/i;

const FORECAST_RE =
  /\b(?:will\s+\w+|going\s+to\s+\w+|predict|forecast|expect(?:ed|s)?\s+to|by\s+20\d{2})\b/i;

const CAUSAL_RE =
  /\b(?:because|due\s+to|caused\s+by|as\s+a\s+result\s+of|leads?\s+to|results?\s+in)\b/i;

const COMPARISON_RE =
  /\b(?:more|less|larger|smaller|bigger|greater|better|worse|faster|slower|taller|shorter|heavier|lighter|than|the\s+(?:largest|smallest|biggest|greatest|best|worst|fastest|slowest|tallest|shortest))\b/i;

const DEFINITION_RE =
  /\b(?:is\s+an?\s+\w+|formula\s+for|symbol\s+for|means|defined\s+as|refers\s+to|stands\s+for)\b/i;

const DATE_RE = /\b(?:19|20)\d{2}\b/;
const MONTH_DATE_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/i;
const NUMERIC_RE = /\d/;

const PRICE_VOLATILITY_RE = /\b(?:price|stock|rate|exchange|market|quote)\b/i;
const SLOW_VOLATILITY_RE =
  /\b(?:today|yesterday|tomorrow|this\s+(?:week|month|year)|news|breaking|ceo|cto|president|prime\s+minister|chief|head\s+of|director)\b/i;

export function classifyClaim(text: string): ClaimClassification {
  const type = classifyType(text);
  const checkable = type !== 'opinion' && type !== 'forecast';
  const volatility = classifyVolatility(text, type);
  return { type, checkable, volatility };
}

function classifyType(text: string): ClaimType {
  if (OPINION_RE.test(text)) return 'opinion';
  if (FORECAST_RE.test(text)) return 'forecast';
  if (CAUSAL_RE.test(text)) return 'causal';
  if (COMPARISON_RE.test(text)) return 'comparison';
  if (DEFINITION_RE.test(text)) return 'definition';
  if (DATE_RE.test(text) || MONTH_DATE_RE.test(text)) return 'date';
  if (NUMERIC_RE.test(text)) return 'numeric';
  return 'entity-relation';
}

function classifyVolatility(text: string, type: ClaimType): ClaimVolatility {
  if (type === 'forecast') return 'fast';
  if (PRICE_VOLATILITY_RE.test(text)) return 'fast';
  if (type === 'date' || SLOW_VOLATILITY_RE.test(text)) return 'slow';
  return 'stable';
}
// === FILE END ===