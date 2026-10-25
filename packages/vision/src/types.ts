export type Sensitivity = 'S0' | 'S1' | 'S2';

export interface ImagePayload {
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AnalysisResult {
  analyzed: boolean;
  text?: string;
  reason?: string;
}