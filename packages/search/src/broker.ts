import { guardedFetch } from '@aura-lie/security';
import type { SearchResult } from './types.js';
import { SearchBrokerError } from './types.js';

/**
 * PRD Section 8.5: Search Broker.
 * Prioritizes keyless, free sources. 
 * Default implementation uses Wikipedia's free REST API.
 */
export class SearchBroker {
  public async search(query: string): Promise<SearchResult[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=5&format=json&origin=*`;
      
      // Cost Guard L1: Must use guardedFetch
      const response = await guardedFetch(url);
      
      if (!response.ok) {
        throw new SearchBrokerError(`Wikipedia API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const results: SearchResult[] = [];

      if (data.query && data.query.search) {
        for (const item of data.query.search) {
          results.push({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
            snippet: item.snippet.replace(/<[^>]+>/g, ''), // Strip HTML tags from snippet
            domain: 'en.wikipedia.org',
            tier: 3
          });
        }
      }

      return results;
    } catch (err: any) {
      if (err instanceof SearchBrokerError) throw err;
      throw new SearchBrokerError(`Search failed: ${err.message}`);
    }
  }
}