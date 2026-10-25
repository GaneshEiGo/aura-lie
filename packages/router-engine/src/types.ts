// packages/router-engine/src/types.ts
// PRD 7.4, 7.3, 7.5. Reuses Candidate / ModelFamily / ModelRole from
// circuit-breaker so routing output feeds directly into runWaterfall.

import type {
  Candidate,
  ModelFamily,
  ModelRole,
} from '@aura-lie/circuit-breaker';

export type { Candidate, ModelFamily, ModelRole };

export type Intent =
  | 'chat'
  | 'question'
  | 'research'
  | 'compute'
  | 'create'
  | 'plan'
  | 'code'
  | 'file'
  | 'memory'
  | 'action'
  | 'meta';

export type Language = 'en' | 'hi' | 'hinglish' | 'other';
export type LoopClass = 'light' | 'standard' | 'deep';
export type SensitivityHint = 'S0' | 'S1' | 'S2';
export type RiskTier = 0 | 1 | 2 | 3;

export interface Features {
  intent: Intent;
  riskTier: RiskTier;
  needsFreshInfo: boolean;
  tools: string[];
  loop: LoopClass;
  sensitivityHint: SensitivityHint;
  language: Language;
  confidence: number; // 0..1
}

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  json: boolean;
  tools: boolean;
}

export interface ModelInfo {
  family: ModelFamily;
  model: string;
  lane: 'private' | 'training-risk';
  contextWindow: number;
  tokensPerMinute: number;
  capabilities: ModelCapabilities;
  latencyClass: 'fast' | 'balanced' | 'strong';
  capability: Partial<Record<ModelRole, number>>;
  /** PRD 4.1 / Cost Guard Layer 2: a `paid: true` model is never routed. */
  paid?: boolean;
}

export interface BreakerLike {
  canAttempt(family: string): boolean;
  getState(family: string): 'closed' | 'open' | 'half-open';
}

export interface ModelRegistry {
  list(): ModelInfo[];
  byRole(role: ModelRole): ModelInfo[];
}

export interface RoutingOptions {
  /** Breaker registry — candidates whose family is not 'closed' are rejected (PRD 7.4 hard filter #4). */
  breakers?: BreakerLike;
  /** 0..1 quota headroom per family; missing entry → 1.0 (assume available). */
  headroom?: (family: ModelFamily) => number;
  /** Model registry override; defaults to `createDefaultRegistry()`. */
  registry?: ModelRegistry;
  /** PRD 12.3: S1 may fall to training-risk lane only if the user allows it. */
  allowTrainingRiskForS1?: boolean;
  /** FR-TRUTH-05: judge role prefers a family different from the generator. */
  generatorFamily?: ModelFamily;
  /** Override the auto token estimate. */
  promptTokensEstimate?: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  capabilityFit: number;
  headroom: number;
  health: number;
  latencyFit: number;
  diversityBonus: number;
  score: number;
  rejected?: { filter: string; reason: string };
}

export interface RoutingResult {
  role: ModelRole;
  features: Features;
  candidates: Candidate[];
  scored: ScoredCandidate[];
  promptTokens: number;
}