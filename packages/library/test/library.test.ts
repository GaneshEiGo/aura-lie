import { describe, it, expect } from 'vitest';
import { TextChunker } from '../src/chunker.js';
import { LibraryIndexer } from '../src/indexer.js';

describe('Library Ingestion (PRD 9.10)', () => {
  const chunker = new TextChunker(50, 10); // Small chunk size for testing

  it('should chunk text with overlap', () => {
    const text = "This is sentence one. This is sentence two. This is sentence three.";
    const chunks = chunker.chunk(text);
    
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('This is sentence one.');
  });

  it('should index a file and store vectors', async () => {
    const indexer = new LibraryIndexer();
    const text = "Aura-lie is a private AI assistant. It uses Cloudflare Workers.";
    
    // Mock embedding function (returns a 3D vector based on text length)
    const mockEmbed = async (t: string) => [t.length, 1.0, 0.5];

    const result = await indexer.indexFile('file-1', text, mockEmbed);
    
    expect(result.fileId).toBe('file-1');
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.totalCharacters).toBe(text.length);

    // Verify we can search it
    const searchResults = indexer.search([text.length, 1.0, 0.5], 1);
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].document.text).toContain("Aura-lie is a private AI assistant.");
  });
});