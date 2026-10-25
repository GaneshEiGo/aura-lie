// packages/truth-pipeline/test/truth-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractClaims,
  splitSentences,
  classifyType,
  inferVolatility,
  computeFactors,
  verifyTurn,
  mapClaimToKind,
  tierForPool,
  hostOf,
} from '../src/index.js';
import type {
  ExtractedClaim,
  JudgeVerdict,
  VerifyTurnDeps,
} from '../src/index.js';
import {
  SearchBroker,
  SearchLedger,
  VerifyLaterQueue,
  DEFAULT_POOLS,
} from '@aura-lie/search-broker';
import type {
  SearchProvider,
  SourceResult,
  PoolId,
  Clock as BrokerClock,
} from '@aura-lie/search-broker';
import type { Candidate, ModelFamily } from '@aura-lie/circuit-breaker';
import type { Features } from '@aura-lie/router-engine';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function fixedClock(at: number): BrokerClock {
  return { now: () => at };
}

function makeProvider(
  handler: (poolId: PoolId, query: string) => SourceResult | null,
): SearchProvider {
  return {
    async search(poolId, query) {
      return handler(poolId, query);
    },
  };
}

function makeBroker(provider: SearchProvider): SearchBroker {
  const clock = fixedClock(new Date(2026, 9, 20, 12).getTime());
  const ledger = new SearchLedger(DEFAULT_POOLS, clock);
  return new SearchBroker(provider, ledger, new VerifyLaterQueue());
}

function makeFeatures(overrides: Partial<Features> = {}): Features {
  return {
    intent: 'question',
    riskTier: 2,
    needsFreshInfo: false,
    tools: [],
    loop: 'standard',
    sensitivityHint: 'S0',
    language: 'en',
    confidence: 0.8,
    ...overrides,
  };
}

function cand(
  family: ModelFamily,
  role: Candidate['role'] = 'judge',
): Candidate {
  return { family, model: `${family}-model`, role };
}

function makeDeps(
  overrides: Partial<VerifyTurnDeps> & {
    judgeHandler?: (claim: string, passage: string) => JudgeVerdict;
  } = {},
): VerifyTurnDeps {
  const judgeHandler =
    overrides.judgeHandler ??
    ((claim: string, passage: string): JudgeVerdict => {
      if (passage.includes(claim.slice(0, 10))) {
        return { stance: 'supports', quote: passage, rationale: 'explicit' };
      }
      return { stance: 'neutral', quote: '', rationale: 'no match' };
    });

  return {
    broker: overrides.broker ?? makeBroker(makeProvider(() => null)),
    judgeCandidates: overrides.judgeCandidates ?? [
      cand('gemini'),
      cand('cerebras'),
    ],
    judgeFn:
      overrides.judgeFn ??
      (async (_candidate, claim, passage) => judgeHandler(claim, passage)),
    drafterFamily: overrides.drafterFamily,
    breakers: overrides.breakers,
    clock: overrides.clock,
  };
}

// -----------------------------------------------------------------------------
describe('Truth Pipeline (PRD 8.2, 8.3, 8.4, 8.7)', () => {
  // ---- Sentence / claim extraction --------------------------------
  it('splitSentences splits on . ! ?', () => {
    expect(splitSentences('One. Two! Three?')).toEqual([
      'One.',
      'Two!',
      'Three?',
    ]);
  });

  it('splitSentences returns empty for empty input', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('classifyType: numeric', () => {
    expect(classifyType('The price is 42 dollars.')).toBe('numeric');
  });

  it('classifyType: date', () => {
    expect(classifyType('It was released in 2026.')).toBe('date');
  });

  it('classifyType: definition', () => {
    expect(classifyType('Paris is the capital of France.')).toBe(
      'definition',
    );
  });

  it('classifyType: causal', () => {
    expect(classifyType('Prices fell because supply rose.')).toBe('causal');
  });

  it('classifyType: comparison', () => {
    expect(classifyType('Model A is faster than model B.')).toBe(
      'comparison',
    );
  });

  it('classifyType: forecast', () => {
    expect(classifyType('The market will grow in 2027.')).toBe('forecast');
  });

  it('classifyType: opinion', () => {
    expect(classifyType('I think this is great.')).toBe('opinion');
  });

  it('classifyType: entity-relation fallback', () => {
    expect(classifyType('Alice works at Acme Corp.')).toBe('entity-relation');
  });

  it('inferVolatility: date → fast', () => {
    const c = classifyType('It was released in 2026.');
    expect(inferVolatility('It was released in 2026.', c)).toBe('fast');
  });

  it('inferVolatility: definition → stable', () => {
    expect(inferVolatility('X is Y.', 'definition')).toBe('stable');
  });

  // ---- Full extractor ----------------------------------------------
  it('extractClaims returns [] for empty input', () => {
    expect(extractClaims('', 5)).toEqual([]);
  });

  it('extractClaims returns [] for maxClaims = 0', () => {
    expect(extractClaims('One two three.', 0)).toEqual([]);
  });

  it('extractClaims skips opinions', () => {
    const claims = extractClaims(
      'I think this is great. The sky is blue.',
      5,
    );
    expect(claims.length).toBe(1);
    expect(claims[0].text).toBe('The sky is blue.');
  });

  it('extractClaims marks first claim as central', () => {
    const claims = extractClaims(
      'The capital of France is Paris. It sits on the Seine.',
      5,
    );
    expect(claims.length).toBe(2);
    expect(claims[0].importance).toBe('central');
    expect(claims[0].importanceScore).toBe(1.0);
    expect(claims[1].importance).toBe('supporting');
    expect(claims[1].importanceScore).toBe(0.5);
  });

  it('extractClaims respects maxClaims', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Fact number ${i} is true.`).join(' ');
    const claims = extractClaims(text, 3);
    expect(claims.length).toBe(3);
  });

  it('extractClaims skips very short sentences', () => {
    const claims = extractClaims('Hi. Yes. The capital is Paris.', 5);
    expect(claims.length).toBe(1);
    expect(claims[0].text).toBe('The capital is Paris.');
  });

  // ---- Sources helpers -------------------------------------------
  it('mapClaimToKind: definition → definition', () => {
    expect(mapClaimToKind('definition')).toBe('definition');
  });

  it('mapClaimToKind: numeric → general', () => {
    expect(mapClaimToKind('numeric')).toBe('general');
  });

  it('tierForPool: wikipedia is high-quality (90)', () => {
    expect(tierForPool('wikipedia')).toBe(90);
  });

  it('tierForPool: arxiv is peer-reviewed (90)', () => {
    expect(tierForPool('arxiv')).toBe(90);
  });

  it('tierForPool: jina is lower-tier (50)', () => {
    expect(tierForPool('jina')).toBe(50);
  });

  it('hostOf extracts a hostname', () => {
    expect(hostOf('https://en.wikipedia.org/wiki/Paris')).toBe(
      'en.wikipedia.org',
    );
  });

  it('hostOf returns empty string for malformed URLs', () => {
    expect(hostOf('not-a-url')).toBe('');
  });

  // ---- Factor computation ----------------------------------------
  it('computeFactors: empty sources → all zeros', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'definition',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'stable',
    };
    expect(computeFactors({ claim, sources: [], stances: [] })).toEqual({
      S: 0,
      E: 0,
      A: 0,
      F: 0,
    });
  });

  it('computeFactors: 3 independent sources → f(n) = 1.0', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'definition',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'stable',
    };
    const factors = computeFactors({
      claim,
      sources: [
        { id: '1', title: 'a', domain: 'a', tier: 90, independenceGroup: 'wikipedia', quote: 'x', matchOk: true },
        { id: '2', title: 'b', domain: 'b', tier: 90, independenceGroup: 'arxiv', quote: 'x', matchOk: true },
        { id: '3', title: 'c', domain: 'c', tier: 90, independenceGroup: 'crossref', quote: 'x', matchOk: true },
      ],
      stances: [{ stance: 'supports', quote: 'x', rationale: '' }],
    });
    expect(factors.S).toBe(90); // 90 × 1.0
    expect(factors.E).toBe(100);
    expect(factors.A).toBe(100);
  });

  it('computeFactors: single source → f(n) = 0.80', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'definition',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'stable',
    };
    const factors = computeFactors({
      claim,
      sources: [
        { id: '1', title: 'a', domain: 'a', tier: 90, independenceGroup: 'wikipedia', quote: 'x', matchOk: true },
      ],
      stances: [{ stance: 'supports', quote: 'x', rationale: '' }],
    });
    expect(factors.S).toBeCloseTo(72, 5); // 90 × 0.80
  });

  it('computeFactors: 2 disagreeing judges → A = 50', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'definition',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'stable',
    };
    const factors = computeFactors({
      claim,
      sources: [
        { id: '1', title: 'a', domain: 'a', tier: 90, independenceGroup: 'wikipedia', quote: 'x', matchOk: true },
      ],
      stances: [
        { stance: 'supports', quote: 'x', rationale: '' },
        { stance: 'contradicts', quote: 'x', rationale: '' },
      ],
    });
    expect(factors.A).toBe(50);
    expect(factors.E).toBe(100); // supports present + quote matched
  });

  it('computeFactors: quote mismatch → E = 0', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'definition',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'stable',
    };
    const factors = computeFactors({
      claim,
      sources: [
        { id: '1', title: 'a', domain: 'a', tier: 90, independenceGroup: 'wikipedia', quote: 'x', matchOk: false },
      ],
      stances: [{ stance: 'supports', quote: 'x', rationale: '' }],
    });
    expect(factors.E).toBe(0);
  });

  it('computeFactors: fast volatility → F = 90', () => {
    const claim: ExtractedClaim = {
      id: 'claim-1',
      text: 'x',
      type: 'numeric',
      importance: 'central',
      importanceScore: 1.0,
      volatility: 'fast',
    };
    const factors = computeFactors({
      claim,
      sources: [
        { id: '1', title: 'a', domain: 'a', tier: 90, independenceGroup: 'wikipedia', quote: 'x', matchOk: true },
      ],
      stances: [{ stance: 'supports', quote: 'x', rationale: '' }],
    });
    expect(factors.F).toBe(90);
  });

  // ---- verifyTurn -------------------------------------------------
  it('verifyTurn returns empty when text is empty', async () => {
    const result = await verifyTurn(
      { text: '', features: makeFeatures(), maxClaims: 5 },
      makeDeps(),
    );
    expect(result.claims).toEqual([]);
    expect(result.checked).toBe(0);
    expect(result.checkable).toBe(0);
  });

  it('verifyTurn skips verification at riskTier = 0', async () => {
    const result = await verifyTurn(
      {
        text: 'Paris is the capital of France.',
        features: makeFeatures({ riskTier: 0 }),
        maxClaims: 3,
      },
      makeDeps(),
    );
    expect(result.checked).toBe(0);
    expect(result.checkable).toBeGreaterThan(0);
    expect(result.claims.every((c) => c.score === null)).toBe(true);
  });

  it('verifyTurn returns RECALL_ONLY when broker has no sources', async () => {
    const broker = makeBroker(makeProvider(() => null));
    const result = await verifyTurn(
      {
        text: 'Paris is the capital of France.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 3,
      },
      makeDeps({ broker }),
    );
    // Broker returns unverified (empty sources), so claims become UNVERIFIED.
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims[0].score).toBeNull();
    expect(
      result.claims[0].status === 'UNVERIFIED' ||
        result.claims[0].status === 'RECALL_ONLY',
    ).toBe(true);
  });

  it('verifyTurn scores a claim when a source is found + judge supports', async () => {
    const broker = makeBroker(
      makeProvider((poolId) => {
        if (poolId === 'wikipedia') {
          return {
            poolId,
            url: 'https://en.wikipedia.org/wiki/Paris',
            title: 'Paris',
            snippet: 'Paris is the capital of France.',
          };
        }
        return null;
      }),
    );
    const judgeHandler = (claim: string, passage: string): JudgeVerdict => {
      if (passage.includes('capital') && claim.includes('capital')) {
        return {
          stance: 'supports',
          quote: 'Paris is the capital of France.',
          rationale: 'explicit',
        };
      }
      return { stance: 'neutral', quote: '', rationale: 'no match' };
    };
    const result = await verifyTurn(
      {
        text: 'Paris is the capital of France.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 3,
      },
      makeDeps({ broker, judgeHandler }),
    );
    expect(result.claims.length).toBe(1);
    expect(result.claims[0].score).not.toBeNull();
    expect(result.claims[0].status).toBe('VERIFIED');
    expect(result.claims[0].sources.length).toBe(1);
    expect(result.claims[0].sources[0].matchOk).toBe(true);
    expect(result.checked).toBe(1);
  });

  it('verifyTurn emits a low score when the quote does not match verbatim', async () => {
    const broker = makeBroker(
      makeProvider((poolId) => {
        if (poolId === 'wikipedia') {
          return {
            poolId,
            url: 'https://en.wikipedia.org/wiki/Paris',
            title: 'Paris',
            snippet: 'Paris is the capital of France.',
          };
        }
        return null;
      }),
    );
    const judgeHandler = (): JudgeVerdict => ({
      stance: 'supports',
      quote: 'This quote does not exist in the passage',
      rationale: 'fabricated',
    });
    const result = await verifyTurn(
      {
        text: 'Paris is the capital of France.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 3,
      },
      makeDeps({ broker, judgeHandler }),
    );
    expect(result.claims[0].sources[0].matchOk).toBe(false);
    expect(result.claims[0].score).toBeLessThanOrEqual(40);
  });

  it('verifyTurn enforces maxClaims', async () => {
    const broker = makeBroker(
      makeProvider((poolId) =>
        poolId === 'wikipedia'
          ? {
              poolId,
              url: 'https://en.wikipedia.org/wiki/X',
              title: 'X',
              snippet: 'Fact one is true. Fact two is true.',
            }
          : null,
      ),
    );
    const result = await verifyTurn(
      {
        text: 'Fact one is true. Fact two is true. Fact three is true.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 2,
      },
      makeDeps({ broker }),
    );
    expect(result.checkable).toBe(2);
  });

  it('verifyTurn filters out the drafter family (FR-TRUTH-05)', async () => {
    const broker = makeBroker(
      makeProvider((poolId) =>
        poolId === 'wikipedia'
          ? {
              poolId,
              url: 'https://en.wikipedia.org/wiki/X',
              title: 'X',
              snippet: 'Fact one is true.',
            }
          : null,
      ),
    );
    const usedCandidates: ModelFamily[] = [];
    const deps = makeDeps({
      broker,
      drafterFamily: 'groq',
      judgeCandidates: [cand('groq'), cand('gemini'), cand('cerebras')],
      judgeFn: async (candidate, _claim, passage) => {
        usedCandidates.push(candidate.family);
        return {
          stance: 'supports',
          quote: passage,
          rationale: 'explicit',
        };
      },
    });
    await verifyTurn(
      {
        text: 'Fact one is true.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 3,
      },
      deps,
    );
    expect(usedCandidates).not.toContain('groq');
    expect(usedCandidates.length).toBeGreaterThan(0);
  });

  it('verifyTurn returns graceful fallback when verifyOne throws', async () => {
    const broker = makeBroker(
      makeProvider(() => {
        throw new Error('provider down');
      }),
    );
    const result = await verifyTurn(
      {
        text: 'Paris is the capital of France.',
        features: makeFeatures({ riskTier: 1 }),
        maxClaims: 3,
      },
      makeDeps({ broker }),
    );
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims[0].score).toBeNull();
  });
});