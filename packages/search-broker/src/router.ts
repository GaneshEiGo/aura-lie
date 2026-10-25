// packages/search-broker/src/router.ts
// PRD 8.3 + 8.5 + 8.6: source retrieval order per claim kind and risk tier.

import type { BrokerClaim, PoolId } from './types.js';

const BY_KIND: Record<string, PoolId[]> = {
  entity: ['wikipedia', 'wikidata', 'gemini-grounding'],
  definition: ['wikipedia', 'wikidata', 'gemini-grounding'],
  science: ['arxiv', 'crossref', 'pubmed', 'gemini-grounding'],
  general: ['wikipedia', 'gemini-grounding', 'exa', 'serper'],
  'high-risk': ['tavily', 'exa', 'gemini-grounding', 'serper'],
};

const BY_KIND_TIER3: Record<string, PoolId[]> = {
  entity: ['tavily', 'wikipedia', 'wikidata', 'exa', 'gemini-grounding'],
  definition: ['tavily', 'wikipedia', 'exa', 'gemini-grounding'],
  science: [
    'tavily',
    'arxiv',
    'crossref',
    'pubmed',
    'exa',
    'gemini-grounding',
  ],
  general: ['tavily', 'exa', 'gemini-grounding', 'wikipedia', 'serper'],
  'high-risk': ['tavily', 'exa', 'gemini-grounding', 'serper'],
};

export function routePools(claim: BrokerClaim): PoolId[] {
  if (claim.riskTier === 0) return [];
  const table = claim.riskTier === 3 ? BY_KIND_TIER3 : BY_KIND;
  return table[claim.kind] ?? table.general;
}