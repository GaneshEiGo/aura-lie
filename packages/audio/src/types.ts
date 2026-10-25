export interface AudioFile {
  id: string;
  durationSeconds: number;
  sizeBytes: number;
}

export interface AudioChunk {
  id: string;
  startTime: number;
  endTime: number;
  blob: any; // In a real app, this would be a Blob
}

export interface TranscriptionResult {
  text: string;
  chunksProcessed: number;
}