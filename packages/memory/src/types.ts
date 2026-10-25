export type Origin = 'USER' | 'FILE' | 'WEB' | 'MODEL' | 'DERIVED' | 'INFERRED' | 'UNKNOWN';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type MemoryStatus = 'active' | 'needs_review' | 'archived' | 'forgotten';

export interface MemoryCandidate {
  text: string;
  origin: Origin;
  sensitivity: Sensitivity;
  importance: number; // 1-5 scale
  sourceMessageId: string;
  isExplicit?: boolean; // If the user explicitly said "Remember this"
}

export interface MemoryRecord extends MemoryCandidate {
  id: string;
  createdAt: number;
  expiresAt?: number;
  status: MemoryStatus;
}