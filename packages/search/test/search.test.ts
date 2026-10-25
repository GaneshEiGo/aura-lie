import { describe, it, expect, vi } from 'vitest';
import { SearchBroker, PageFetcher } from '../src/index.js';

// Mock guardedFetch to prevent real network calls during tests
vi.mock('@aura-lie/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aura-lie/security')>();
  return {
    ...actual,
    guardedFetch: vi.fn()
  };
});

import { guardedFetch } from '@aura-lie/security';

describe('Search and Fetch Broker (T-02)', () => {
  it('SearchBroker fetches Wikipedia results and strips HTML', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        query: {
          search: [
            {
              title: 'Solid-state battery',
              snippet: 'A <span class="searchmatch">solid-state battery</span> is a type of battery.'
            }
          ]
        }
      })
    };
    (guardedFetch as any).mockResolvedValue(mockResponse);

    const broker = new SearchBroker();
    const results = await broker.search('solid-state battery');

    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Solid-state battery');
    expect(results[0].snippet).toBe('A solid-state battery is a type of battery.');
    expect(results[0].tier).toBe(3);
  });

  it('PageFetcher returns clean text and a hash', async () => {
    const mockText = "# Test Page\n\nThis is the content of the page.";
    const mockResponse = {
      ok: true,
      text: async () => mockText
    };
    (guardedFetch as any).mockResolvedValue(mockResponse);

    const fetcher = new PageFetcher();
    const page = await fetcher.fetch('https://example.com/page');

    expect(page.title).toBe('Test Page');
    expect(page.text).toBe(mockText);
    expect(page.contentHash).toBeDefined();
  });

  it('PageFetcher blocks local SSRF attempts', async () => {
    const fetcher = new PageFetcher();
    await expect(fetcher.fetch('https://127.0.0.1/admin')).rejects.toThrow('Blocked unsafe URL');
  });
});