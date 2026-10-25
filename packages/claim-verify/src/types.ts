export type ClaimType = 'numeric' | 'date' | 'entity-relation' | 'definition' | 'causal' | 'comparison' | 'forecast' | 'opinion';
export type ClaimImportance = 'central' | 'supporting';
export type ClaimVolatility = 'stable' | 'slow' | 'fast';
export type JudgeStance = 'supports' | 'contradicts' | 'neutral';

export interface ExtractedClaim {
  text: string;
  type: ClaimType;
  importance: ClaimImportance;
  volatility: ClaimVolatility;
}

export interface JudgeResult {
  stance: JudgeStance;
  span: string;
  rationale: string;
}

export interface VerificationResult {
  verified: boolean;
  normalizedQuote: string;
  reason?: string;
}