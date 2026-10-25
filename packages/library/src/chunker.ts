/**
 * PRD Section 9.10: Chunking for file ingestion.
 * Splits text into overlapping chunks to preserve context.
 */
export class TextChunker {
  constructor(
    private chunkSize: number = 500, // characters
    private overlap: number = 50
  ) {}

  public chunk(text: string): string[] {
    if (!text) return [];
    
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      let endIndex = startIndex + this.chunkSize;
      
      // If we're not at the end, try to find a natural break (newline or period)
      if (endIndex < text.length) {
        const slice = text.slice(startIndex, endIndex);
        const lastPeriod = slice.lastIndexOf('.');
        const lastNewline = slice.lastIndexOf('\n');
        
        const breakPoint = Math.max(lastPeriod, lastNewline);
        
        // If a natural break is found within the last 20% of the chunk, use it
        if (breakPoint > this.chunkSize * 0.8) {
          endIndex = startIndex + breakPoint + 1;
        }
      }

      const chunk = text.slice(startIndex, endIndex).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      startIndex = endIndex - this.overlap;
      if (startIndex <= 0) startIndex = endIndex; // Prevent infinite loop
    }

    return chunks;
  }
}