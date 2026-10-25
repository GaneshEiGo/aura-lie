/**
 * Client-side SSE parser to consume the stream from the Edge API.
 */
export class SSEParser {
  public parseChunk(chunk: string): any[] {
    const events: any[] = [];
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            events.push(JSON.parse(data));
          } catch (e) {
            // Ignore malformed JSON chunks
          }
        }
      }
    }
    return events;
  }
}