import { describe, it, expect, vi } from 'vitest';
import { AudioChunker } from '../src/chunker.js';
import { AudioTranscriber } from '../src/transcriber.js';
import type { AudioFile } from '../src/types.js';

describe('Audio & Transcription (PRD 14.1)', () => {
  const chunker = new AudioChunker();
  const transcriber = new AudioTranscriber();

  it('should keep short audio as a single chunk', () => {
    const file: AudioFile = { id: 'a1', durationSeconds: 30, sizeBytes: 1000 };
    const chunks = chunker.chunk(file);
    
    expect(chunks.length).toBe(1);
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[0].endTime).toBe(30);
  });

  it('should split long audio into 60-second chunks', () => {
    const file: AudioFile = { id: 'a2', durationSeconds: 150, sizeBytes: 5000 };
    const chunks = chunker.chunk(file);
    
    expect(chunks.length).toBe(3);
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[0].endTime).toBe(60);
    
    expect(chunks[1].startTime).toBe(60);
    expect(chunks[1].endTime).toBe(120);
    
    expect(chunks[2].startTime).toBe(120);
    expect(chunks[2].endTime).toBe(150);
  });

  it('should transcribe all chunks sequentially', async () => {
    const file: AudioFile = { id: 'a3', durationSeconds: 90, sizeBytes: 3000 };
    const chunks = chunker.chunk(file); // 2 chunks

    const mockSTT = vi.fn()
      .mockResolvedValueOnce('First part of the audio.')
      .mockResolvedValueOnce('Second part of the audio.');

    const result = await transcriber.transcribe(chunks, mockSTT);
    
    expect(result.chunksProcessed).toBe(2);
    expect(result.text).toBe('First part of the audio. Second part of the audio.');
    expect(mockSTT).toHaveBeenCalledTimes(2);
  });

  it('should handle a failing chunk gracefully', async () => {
    const file: AudioFile = { id: 'a4', durationSeconds: 90, sizeBytes: 3000 };
    const chunks = chunker.chunk(file); 

    const mockSTT = vi.fn()
      .mockResolvedValueOnce('First part.')
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await transcriber.transcribe(chunks, mockSTT);
    
    expect(result.chunksProcessed).toBe(1); // Only one succeeded
    expect(result.text).toBe('First part.');
  });
});