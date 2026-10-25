import { guardedFetch, assertSafeUrl } from '@aura-lie/security';
import type { FetchedPage } from './types.js';
import { SearchBrokerError } from './types.js';

/**
 * PRD Section 8.4: Page Fetcher.
 * Uses Jina Reader (free, keyless) to bypass CORS and extract clean text.
 * Enforces SSRF protection via Security package.
 */
export class PageFetcher {
  public async fetch(url: string): Promise<FetchedPage> {
    try {
      // Security L3: Block local IPs and metadata endpoints
      assertSafeUrl(url);

      // Jina Reader prefixes the URL to return markdown
      const jinaUrl = `https://r.jina.ai/${url}`;
      
      const response = await guardedFetch(jinaUrl, {
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (!response.ok) {
        throw new SearchBrokerError(`Fetch failed: ${response.status}`);
      }

      const text = await response.text();
      
      // Simple hash for content integrity checks
      const contentHash = this.simpleHash(text);
      
      // Extract title (first heading if present, otherwise the URL)
      const titleMatch = text.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : url;

      return {
        url,
        title,
        text,
        contentHash,
        fetchedAt: Date.now()
      };
    } catch (err: any) {
      if (err instanceof SearchBrokerError) throw err;
      throw new SearchBrokerError(`Fetch error: ${err.message}`);
    }
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
}