import { TextChunker } from './chunker.js';
import { VectorStore } from '@aura-lie/embed';

export interface IndexingResult {
  fileId: string;
  chunksCreated: number;
  totalCharacters: number;
}

/**
 * PRD Section 9.10: File ingestion pipeline
 * Text -> Chunks -> Embeddings (mocked here for interface) -> VectorStore
 */
export class LibraryIndexer {
  private chunker = new TextChunker();
  private store = new VectorStore();

  public async indexFile(
    fileId: string, 
    text: string, 
    embeddingFn: (text: string) => Promise<number[]>
  ): Promise<IndexingResult> {
    const chunks = this.chunker.chunk(text);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      // In a real app, this calls Workers AI or Gemini Embed
      const embedding = await embeddingFn(chunkText); 
      
      this.store.add(
        `${fileId}-chunk-${i}`,
        chunkText,
        embedding,
        { fileId, chunkIndex: i }
      );
    }

    return {
      fileId,
      chunksCreated: chunks.length,
      totalCharacters: text.length
    };
  }

  public search(queryEmbedding: number[], topK: number = 3) {
    return this.store.search(queryEmbedding, topK);
  }
}