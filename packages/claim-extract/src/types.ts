// === FILE START ===
// packages/claim-extract/src/types.ts
// PRD 8.2 · F-031 · FR-TRUTH-01.

export type ClaimType =
  | 'numeric'
  | 'date'
  | 'entity-relation'
  | 'definition'
  | 'causal'
  | 'comparison'
  | 'forecast'
  | 'opinion';

export type ClaimImportance = 'central' | 'supporting';
export type ClaimVolatility = 'stable' | 'slow' | 'fast';
export type ClaimOrigin =
  | 'USER'
  | 'FILE'
  | 'WEB'
  | 'MODEL'
  | 'DERIVED'
  | 'INFERRED'
  | 'UNKNOWN';

/** PRD 8.2 — the minimum shape Section 73 produces. */
export interface Claim {
  id: string;
  messageId: string;
  /** Atomic, decontextualised claim text. */
  text: string;
  type: ClaimType;
  /** PRD 8.2: false for opinion and forecast. */
  checkable: boolean;
  importance: ClaimImportance;
  volatility: ClaimVolatility;
  /** PRD 9.4 / FR-TRUTH-08. */
  origin: ClaimOrigin;
}

export interface ExtractOptions {
  /** Default 'msg'. Persisted with every claim. */
  messageId?: string;
  /** Default 'MODEL' — extraction runs on the model's draft answer. */
  origin?: ClaimOrigin;
  /** Default 25. Central claims come first. */
  cap?: number;
}

export interface ClaimClassification {
  type: ClaimType;
  checkable: boolean;
  volatility: ClaimVolatility;
}
// === FILE END ===