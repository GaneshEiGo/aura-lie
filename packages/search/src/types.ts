export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  tier: number; // 1 = official/primary, 2 = reputable, 3 = wiki/reference, 4 = unknown
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  contentHash: string;
  fetchedAt: number;
}

export class SearchBrokerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchBrokerError';
  }
}