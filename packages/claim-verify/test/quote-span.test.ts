import { describe, it, expect } from 'vitest';
import { QuoteSpanVerifier } from '../src/quote-span.js';

describe('QuoteSpanVerifier (T-03)', () => {
  const verifier = new QuoteSpanVerifier();

  it('should verify an exact match', () => {
    const quote = "Solid-state batteries use a solid electrolyte";
    const page = "A new study shows. Solid-state batteries use a solid electrolyte. This is a breakthrough.";
    const result = verifier.verify(quote, page);
    expect(result.verified).toBe(true);
  });

  it('should verify a match with different whitespace', () => {
    const quote = "Solid-state   batteries\n use a solid electrolyte";
    const page = "Solid-state batteries use a solid electrolyte";
    const result = verifier.verify(quote, page);
    expect(result.verified).toBe(true);
  });

  it('should reject a paraphrased quote (near-match)', () => {
    const quote = "Solid-state batteries utilise a solid electrolyte";
    const page = "Solid-state batteries use a solid electrolyte";
    const result = verifier.verify(quote, page);
    expect(result.verified).toBe(false);
  });

  it('should reject an invented quote', () => {
    const quote = "Solid-state batteries have a 99% market share";
    const page = "Solid-state batteries use a solid electrolyte";
    const result = verifier.verify(quote, page);
    expect(result.verified).toBe(false);
  });

  it('should reject a quote longer than 25 words', () => {
    const quote = "word ".repeat(26).trim();
    const page = quote; 
    const result = verifier.verify(quote, page);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('25-word');
  });
});