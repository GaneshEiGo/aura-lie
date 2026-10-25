import { describe, it, expect, vi } from 'vitest';
import { TruthPipeline } from '../src/pipeline.js';
import { SearchBroker, PageFetcher } from '@aura-lie/search';

// Mock Search and Fetch to ensure zero network calls
vi.mock('@aura-lie/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aura-lie/search')>();
  return {
    ...actual,
    SearchBroker: vi.fn().mockImplementation(() => ({
      search: vi.fn().mockResolvedValue([{ title: 'Test', url: 'https://test.com', snippet: '', domain: 'test.com', tier: 1 }])
    })),
    PageFetcher: vi.fn().mockImplementation(() => ({
      fetch: vi.fn().mockResolvedValue({ url: 'https://test.com', title: 'Test', text: 'The efficiency is 41%. It is a great battery.', contentHash: 'abc', fetchedAt: Date.now() })
    }))
  };
});

describe('TruthPipeline (PRD 8.3)', () => {
  it('should extract, verify, and score claims', async () => {
    // Mock LLM responses based on the prompt
    const mockLLM = vi.fn().mockImplementation(async (prompt: string) => {
      if (prompt.includes('list atomic, checkable factual claims')) {
        return JSON.stringify([{ text: "The efficiency is 41%.", type: "numeric", importance: "central", volatility: "stable" }]);
      }
      if (prompt.includes('Decide whether the PASSAGE supports')) {
        return JSON.stringify({ stance: "supports", span: "The efficiency is 41%.", rationale: "Exact match" });
      }
      return "";
    });

    const pipeline = new TruthPipeline(mockLLM);
    const report = await pipeline.verifyAnswer("The new battery is great. The efficiency is 41%.", 3);

    expect(report.checkedCount).toBe(1);
    expect(report.claims[0].status).toBe('VERIFIED');
    expect(report.claims[0].quoteMatched).toBe(true);
    expect(report.chip).toBe('VERIFIED');
  });

  it('should drop citations that fail the quote-span check (Law L3)', async () => {
    const mockLLM = vi.fn().mockImplementation(async (prompt: string) => {
      if (prompt.includes('list atomic, checkable factual claims')) {
        return JSON.stringify([{ text: "The efficiency is 99%.", type: "numeric", importance: "central", volatility: "stable" }]);
      }
      if (prompt.includes('Decide whether the PASSAGE supports')) {
        // LLM hallucinates a quote that doesn't exist in the mocked page text
        return JSON.stringify({ stance: "supports", span: "The efficiency is 99%.", rationale: "Hallucinated" });
      }
      return "";
    });

    const pipeline = new TruthPipeline(mockLLM);
    const report = await pipeline.verifyAnswer("The efficiency is 99%.", 3);

    // Quote match should fail
    expect(report.claims[0].quoteMatched).toBe(false);
    // Score should be capped due to failed quote
    expect(report.claims[0].score).toBeLessThanOrEqual(40);
    expect(report.claims[0].status).toBe('WEAK');
  });

  it('should handle casual chat with no claims', async () => {
    const mockLLM = vi.fn().mockResolvedValue("[]"); // No claims extracted
    const pipeline = new TruthPipeline(mockLLM);
    
    const report = await pipeline.verifyAnswer("Hello!", 3);
    expect(report.checkedCount).toBe(0);
    expect(report.chip).toBe('RECALL-ONLY');
  });
});