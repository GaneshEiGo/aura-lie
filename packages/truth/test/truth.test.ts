import { describe, it, expect } from 'vitest';
import { isQuoteValid, calculateRawScore, scoreClaim, summarizeResponse } from '../src/index.js';
import type { ClaimForScoring } from '../src/index.js';

describe('Truth Engine (T-03, T-06, T-33)', () => {
  it('validates a quote only if it is a verbatim substring', () => {
    const pageText = "The Q3 2027 date appears only in the company's own release; the paper's appendix says 2028.";
    expect(isQuoteValid("the paper's appendix says 2028", pageText)).toBe(true);
    expect(isQuoteValid("appendix says it is 2028", pageText)).toBe(false);
    const longQuote = "This is a very long quote that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on.";
    expect(isQuoteValid(longQuote, longQuote)).toBe(false);
  });

  it('calculates the raw score using renormalized weights', () => {
    const score = calculateRawScore({ S: 40, E: 100, A: 50, F: 60 });
    expect(score).toBeCloseTo(63.15, 1);
  });

  it('applies the contradiction penalty and caps correctly', () => {
    const claim: ClaimForScoring = {
      id: 'c1', text: 'test', importance: 0.8,
      factors: { S: 40, E: 100, A: 50, F: 60 },
      hasStrongContradiction: true,
      isQuoteVerified: true,
      hasSource: true,
      isInterestedParty: false
    };

    const scored = scoreClaim(claim);
    expect(scored.score).toBe(48);
    expect(scored.status).toBe('CONFLICTED');
    expect(scored.band).toBe('conflicted');
    expect(scored.capsApplied).toContain('Strong contradiction (-15)');
  });

  it('caps score at 40 if quote match fails', () => {
    const claim: ClaimForScoring = {
      id: 'c2', text: 'test', importance: 0.5,
      factors: { S: 100, E: 100, A: 100, F: 100 },
      hasStrongContradiction: false,
      isQuoteVerified: false,
      hasSource: true,
      isInterestedParty: false
    };

    const scored = scoreClaim(claim);
    expect(scored.score).toBe(40);
    expect(scored.status).toBe('WEAK');
    expect(scored.capsApplied).toContain('Quote match failed (max 40)');
  });

  it('caps score at 69 for interested parties', () => {
    const claim: ClaimForScoring = {
      id: 'c3', text: 'test', importance: 0.5,
      factors: { S: 100, E: 100, A: 100, F: 100 },
      hasStrongContradiction: false,
      isQuoteVerified: true,
      hasSource: true,
      isInterestedParty: true
    };

    const scored = scoreClaim(claim);
    expect(scored.score).toBe(69);
    expect(scored.status).toBe('MIXED');
    expect(scored.capsApplied).toContain('Interested party only (max 69)');
  });

  it('applies the weakest critical link rule at the response level', () => {
    const claims: ClaimForScoring[] = [
      {
        id: 'c1', text: 'strong claim', importance: 0.8,
        factors: { S: 100, E: 100, A: 100, F: 100 },
        hasStrongContradiction: false, isQuoteVerified: true, hasSource: true, isInterestedParty: false
      },
      {
        id: 'c2', text: 'weak critical claim', importance: 0.9,
        factors: { S: 40, E: 100, A: 50, F: 60 },
        hasStrongContradiction: true, isQuoteVerified: true, hasSource: true, isInterestedParty: false
      }
    ];

    const summary = summarizeResponse(claims, 2);
    expect(summary.overall).toBe(63);
    expect(summary.chip).toBe('CHECK');
    expect(summary.checked).toBe(2);
  });
});