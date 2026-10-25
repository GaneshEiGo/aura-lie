// === FILE START ===
// packages/truth-score/src/quote-span.ts
// PRD 8.4 · F-033 · FR-TRUTH-04 · T-03.
//
// The quote-span check that makes fake citations structurally impossible:
//
//   1. Retriever fetches page text, stores a content hash.
//   2. Judge copies a span character-for-character.
//   3. Code normalises whitespace + unicode punctuation + case, checks
//      substring inclusion. No match → evidence dropped.
//   4. Only matched spans are stored (quote_verified = true) and shown.
//   5. Quotes are capped at 25 words.
//
// This module is the string-check half. The prompt-building half lives in
// @aura-lie/claim-verify (5 extractor tests + 5 quote-span tests, untouched).
//
// Seven match kinds give the caller precise debugging info:
//   exact       — byte-for-byte substring
//   normalized  — after whitespace + unicode + case normalisation
//   paraphrase  — high word overlap with some page sentence, but no exact match
//   not_found   — no substring, no significant overlap
//   too_long    — quote exceeds the 25-word cap
//   empty       — proposed quote is empty
//   no_page     — fetched page text is empty

export type QuoteMatchKind =
  | 'exact'
  | 'normalized'
  | 'paraphrase'
  | 'not_found'
  | 'too_long'
  | 'empty'
  | 'no_page';

export interface QuoteVerification {
  verified: boolean;
  normalizedMatch: boolean;
  matchKind: QuoteMatchKind;
  wordCount: number;
  reason: string;
}

export const MAX_QUOTE_WORDS = 25;
export const PARAPHRASE_OVERLAP_THRESHOLD = 0.6;

// -----------------------------------------------------------------------------
// Normalization — whitespace, unicode punctuation, case
// -----------------------------------------------------------------------------

const UNICODE_MAP: Array<[RegExp, string]> = [
  [/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"'],
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u2013\u2014\u2015]/g, '-'],
  [/[\u00A0\u2007\u202F]/g, ' '],
  [/[\u200B\u200C\u200D\uFEFF]/g, ''],
];

export function normalizeForMatch(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let out = text;
  for (const [re, rep] of UNICODE_MAP) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

// -----------------------------------------------------------------------------
// Paraphrase detection — best sentence overlap in the page
// -----------------------------------------------------------------------------

function wordOverlap(quote: string, page: string): number {
  const qWords = quote
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (qWords.length === 0) return 0;
  const sentences = page.split(/[.!?]+/);
  let best = 0;
  for (const sent of sentences) {
    const pLower = sent.toLowerCase();
    let hits = 0;
    for (const w of qWords) if (pLower.includes(w)) hits++;
    const score = hits / qWords.length;
    if (score > best) best = score;
  }
  return best;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function verifyQuoteSpan(
  fetchedText: string,
  proposedQuote: string,
): QuoteVerification {
  const quoteRaw = typeof proposedQuote === 'string' ? proposedQuote.trim() : '';
  const pageRaw = typeof fetchedText === 'string' ? fetchedText : '';

  // 1 — empty quote
  if (quoteRaw.length === 0) {
    return {
      verified: false,
      normalizedMatch: false,
      matchKind: 'empty',
      wordCount: 0,
      reason: 'quote is empty',
    };
  }

  // 2 — word-count cap
  const wordCount = quoteRaw.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_QUOTE_WORDS) {
    return {
      verified: false,
      normalizedMatch: false,
      matchKind: 'too_long',
      wordCount,
      reason: `quote has ${wordCount} words, exceeds ${MAX_QUOTE_WORDS}-word cap`,
    };
  }

  // 3 — empty page
  if (pageRaw.trim().length === 0) {
    return {
      verified: false,
      normalizedMatch: false,
      matchKind: 'no_page',
      wordCount,
      reason: 'fetched page text is empty',
    };
  }

  // 4 — exact byte-for-byte substring
  if (pageRaw.includes(quoteRaw)) {
    return {
      verified: true,
      normalizedMatch: false,
      matchKind: 'exact',
      wordCount,
      reason: 'exact byte-for-byte match',
    };
  }

  // 5 — normalized substring (whitespace + unicode + case)
  const nq = normalizeForMatch(quoteRaw);
  const np = normalizeForMatch(pageRaw);
  if (nq.length > 0 && np.includes(nq)) {
    return {
      verified: true,
      normalizedMatch: true,
      matchKind: 'normalized',
      wordCount,
      reason: 'normalized (whitespace/unicode/case) match',
    };
  }

  // 6 — paraphrase detection (still a failure, more informative)
  const overlap = wordOverlap(quoteRaw, pageRaw);
  if (overlap >= PARAPHRASE_OVERLAP_THRESHOLD) {
    return {
      verified: false,
      normalizedMatch: false,
      matchKind: 'paraphrase',
      wordCount,
      reason: `paraphrase detected (${(overlap * 100).toFixed(0)}% word overlap)`,
    };
  }

  // 7 — not found
  return {
    verified: false,
    normalizedMatch: false,
    matchKind: 'not_found',
    wordCount,
    reason: 'quote not found in page',
  };
}
// === FILE END ===