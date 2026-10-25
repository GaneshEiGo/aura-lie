// packages/search-broker/src/pools.ts
// Default pool configuration, seeded from PRD 8.5.
// Every number here has a named constant and a corresponding [VERIFY] note
// in the PRD. Live headers overwrite these at runtime (L6).

import type { PoolConfig } from './types.js';

export const DEFAULT_POOLS: PoolConfig[] = [
  // Wikipedia / Wikidata: keyless, polite, no hard cap. Throttle 5/sec (PRD 4.3).
  {
    id: 'wikipedia',
    priority: 1,
    costPerQuery: 1,
    throttle: { limit: 5, windowMs: 1_000 },
  },
  {
    id: 'wikidata',
    priority: 2,
    costPerQuery: 1,
    throttle: { limit: 5, windowMs: 1_000 },
  },

  // arXiv / Crossref / PubMed: keyless, polite, no cap. Modest throttle.
  {
    id: 'arxiv',
    priority: 3,
    costPerQuery: 1,
    throttle: { limit: 3, windowMs: 1_000 },
  },
  {
    id: 'crossref',
    priority: 4,
    costPerQuery: 1,
    throttle: { limit: 5, windowMs: 1_000 },
  },
  {
    id: 'pubmed',
    priority: 5,
    costPerQuery: 1,
    throttle: { limit: 3, windowMs: 1_000 },
  },

  // Gemini grounding: soft cap 150/day (PRD 8.5 pool table).
  {
    id: 'gemini-grounding',
    priority: 6,
    costPerQuery: 1,
    dailyLimit: 150,
  },

  // Tavily: 1000/month, soft 25/day, 300-credit reserve until day 25.
  {
    id: 'tavily',
    priority: 7,
    costPerQuery: 1,
    monthlyLimit: 1_000,
    dailyLimit: 25,
    monthlyReserveUntilDay: 25,
    monthlyReserveAmount: 300,
  },

  // Exa: 25/day soft.
  {
    id: 'exa',
    priority: 8,
    costPerQuery: 1,
    dailyLimit: 25,
  },

  // Serper: 2,500 one-time, soft 10/day.
  {
    id: 'serper',
    priority: 9,
    costPerQuery: 1,
    dailyLimit: 10,
    totalLimit: 2_500,
  },

  // Jina Reader: 20/min hard throttle.
  {
    id: 'jina',
    priority: 10,
    costPerQuery: 1,
    throttle: { limit: 20, windowMs: 60_000 },
  },
];