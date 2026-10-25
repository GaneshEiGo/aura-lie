import type { AudioFile, AudioChunk } from './types.js';

export class AudioChunker {
  private readonly MAX_CHUNK_DURATION = 60; // 60 seconds per chunk

  public chunk(file: AudioFile): AudioChunk[] {
    const chunks: AudioChunk[] = [];
    
    if (file.durationSeconds <= this.MAX_CHUNK_DURATION) {
      chunks.push({
        id: `${file.id}-chunk-0`,
        startTime: 0,
        endTime: file.durationSeconds,
        blob: 'mock-blob-0'
      });
      return chunks;
    }

    let currentTime = 0;
    let index = 0;

    while (currentTime < file.durationSeconds) {
      const endTime = Math.min(currentTime + this.MAX_CHUNK_DURATION, file.durationSeconds);
      chunks.push({
        id: `${file.id}-chunk-${index}`,
        startTime: currentTime,
        endTime,
        blob: `mock-blob-${index}`
      });
      currentTime = endTime;
      index++;
    }

    return chunks;
  }
}