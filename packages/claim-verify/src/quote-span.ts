import type { VerificationResult } from './types.js';

/**
 * PRD Section 8.4: The Quote-Span Check.
 * Law L3: A displayed citation always contains a verified quote from a real fetched page.
 * This makes fabricated citations structurally impossible.
 */
export class QuoteSpanVerifier {
  public verify(quote: string, pageText: string): VerificationResult {
    if (!quote || !pageText) {
      return { verified: false, normalizedQuote: '', reason: 'Empty quote or page text' };
    }

    // 1. Normalize whitespace (collapse all spaces, tabs, newlines into single spaces)
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    
    const cleanQuote = normalize(quote);
    const cleanPage = normalize(pageText);

    // 2. Cap at 25 words (PRD Copyright Respect)
    const words = cleanQuote.split(' ');
    if (words.length > 25) {
      return { 
        verified: false, 
        normalizedQuote: words.slice(0, 25).join(' ') + '...', 
        reason: 'Quote exceeds 25-word copyright cap' 
      };
    }

    // 3. Exact substring match (case-sensitive, whitespace-normalized)
    const verified = cleanPage.includes(cleanQuote);

    return {
      verified,
      normalizedQuote: cleanQuote,
      reason: verified ? undefined : 'Quote not found in source text'
    };
  }
}