// packages/truth-pipeline/src/sources.ts
// Helpers that translate between truth-pipeline and search-broker shapes.

import type { PoolId, ClaimKind } from './types.js';

export function mapClaimToKind(claimType: string): ClaimKind {
  switch (claimType) {
    case 'definition':
      return 'definition';
    case 'numeric':
    case 'date':
    case 'causal':
    case 'comparison':
    case 'forecast':
    case 'entity-relation':
      return 'general';
    default:
      return 'general';
  }
}

/**
 * PRD 8.7 S-factor table:
 *   primary / official         100
 *   peer-reviewed / reference   90
 *   reputable secondary         75
 *   interested party            50
 *   forum / blog                35
 *   unknown                     20
 *
 * Pool → tier mapping follows the source-quality ordering in PRD 4.3.
 */
export function tierForPool(poolId: PoolId): number {
  switch (poolId) {
    case 'arxiv':
    case 'crossref':
    case 'pubmed':
      return 90;
    case 'wikipedia':
    case 'wikidata':
      return 90;
    case 'gemini-grounding':
    case 'tavily':
    case 'exa':
      return 75;
    case 'serper':
      return 60;
    case 'jina':
      return 50;
    default:
      return 20;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}