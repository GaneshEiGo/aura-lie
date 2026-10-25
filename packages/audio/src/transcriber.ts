import type { AudioChunk, TranscriptionResult } from './types.js';

/**
 * PRD Section 14.1: Transcription fallback.
 * Transcribes chunks sequentially to avoid hitting rate limits.
 */
export class AudioTranscriber {
  public async transcribe(
    chunks: AudioChunk[], 
    sttCaller: (chunk: AudioChunk) => Promise<string>
  ): Promise<TranscriptionResult> {
    let fullText = '';
    let chunksProcessed = 0;

    for (const chunk of chunks) {
      try {
        const text = await sttCaller(chunk);
        if (text && text.trim().length > 0) {
          fullText += text.trim() + ' ';
        }
        chunksProcessed++;
      } catch (err: any) {
        // Log error but continue with other chunks
        console.error(`Failed to transcribe chunk ${chunk.id}: ${err.message}`);
      }
    }

    return {
      text: fullText.trim(),
      chunksProcessed
    };
  }
}