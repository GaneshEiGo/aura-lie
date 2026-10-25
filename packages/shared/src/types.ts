export type Lane = 'private' | 'training-risk';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type Mode = 'Instant' | 'Think' | 'Research' | 'Council';
export type ClaimStatus = 'VERIFIED' | 'SUPPORTED' | 'MIXED' | 'WEAK' | 'CONFLICTED' | 'UNVERIFIED' | 'RECALL_ONLY';
export type Origin = 'USER' | 'FILE' | 'WEB' | 'MODEL' | 'DERIVED' | 'INFERRED' | 'UNKNOWN';
export type MemoryType = 'semantic' | 'episodic' | 'project' | 'temporal';
export type PresenceState = 'idle' | 'working' | 'researching' | 'listening' | 'awaiting' | 'blocked' | 'done' | 'core';

// Mapped directly to the CSS classes in your HTML
export type ClaimBand = 'verified' | 'supported' | 'mixed' | 'weak' | 'conflicted' | 'unverified';

export interface ClaimFactor {
  label: string;
  value: number; // 0 to 1
}

export interface ClaimSource {
  tier: number;
  domain: string;
  title: string;
  date: string;
  quote?: string;
}

export interface Contradiction {
  other: string;
  cause: string;
}