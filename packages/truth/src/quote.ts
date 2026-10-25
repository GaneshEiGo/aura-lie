// packages/truth/src/quote.ts
// PRD 8.4 — strict verbatim substring.
// PRD 5.6 — quotes are capped at 25 words.

import { MAX_QUOTE_WORDS } from './weights.js';

/**
 * Returns true ONLY when:
 *   1. `quote` is a byte-for-byte substring of `text` (case-sensitive, no normalization).
 *   2. `quote` is 25 words or fewer (PRD 5.6 hard cap).
 */
export function isQuoteValid(quote: string, text: string): boolean {
  if (typeof quote !== 'string' || typeof text !== 'string') return false;
  if (quote.length === 0 || text.length === 0) return false;

  // PRD 5.6: quotes are capped at 25 words.
  const wordCount = quote.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_QUOTE_WORDS) return false;

  // PRD 8.4: verbatim substring, case-sensitive, no normalization.
  return text.includes(quote);
}

export interface QuoteCheck {
  valid: boolean;
  reason?: string;
}

/** Richer variant used by the pipeline. Same rules plus a reason string. */
export function checkQuote(quote: string, text: string): QuoteCheck {
  if (typeof quote !== 'string' || typeof text !== 'string') {
    return { valid: false, reason: 'non-string input' };
  }
  if (quote.length === 0) return { valid: false, reason: 'empty quote' };
  if (text.length === 0) return { valid: false, reason: 'empty source text' };

  const wordCount = quote.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_QUOTE_WORDS) {
    return { valid: false, reason: `quote exceeds ${MAX_QUOTE_WORDS} words` };
  }
  if (!text.includes(quote)) {
    return { valid: false, reason: 'quote not found verbatim in source' };
  }
  return { valid: true };
}