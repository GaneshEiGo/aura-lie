// packages/truth-pipeline/src/types.ts
// PRD 8.2, 8.3, 8.4, 8.7.

import type {
  SearchBroker,
  BrokerClaim,
  Sensitivity,
  RiskTier,
  ClaimKind,
  VerifyOutcome,
  SourceResult,
} from '@aura-lie/search-broker';
import type {
  Candidate,
  BreakerRegistry,
  ModelFamily,
} from '@aura-lie/circuit-breaker';
import type { Features } from '@aura-lie/router-engine';
import type { ClaimStatus } from '@aura-lie/truth';

export type {
  Features,
  Sensitivity,
  RiskTier,
  ClaimKind,
  SourceResult,
  BrokerClaim,
  VerifyOutcome,
};

export type ClaimType =
  | 'numeric'
  | 'date'
  | 'entity-relation'
  | 'definition'
  | 'causal'
  | 'comparison'
  | 'forecast'
  | 'opinion';

export type Volatility = 'stable' | 'slow' | 'fast';

export interface ExtractedClaim {
  id: string;
  text: string;
  type: ClaimType;
  importance: 'central' | 'supporting';
  importanceScore: number;
  volatility: Volatility;
}

export interface JudgeVerdict {
  stance: 'supports' | 'contradicts' | 'neutral';
  quote: string;
  rationale: string;
}

export type JudgeFn = (
  candidate: Candidate,
  claim: string,
  passage: string,
) => Promise<JudgeVerdict>;

export interface VerifiedSource {
  id: string;
  title: string;
  domain: string;
  tier: number;
  published?: string;
  independenceGroup: string;
  quote: string;
  matchOk: boolean;
}

export interface VerifiedClaim {
  id: string;
  text: string;
  type: string;
  importance: number | 'central' | 'supporting';
  score: number | null;
  status: ClaimStatus;
  factors: Record<string, number>;
  capsApplied: string[];
  sources: VerifiedSource[];
}

export interface VerificationResult {
  claims: VerifiedClaim[];
  checked: number;
  checkable: number;
}

export interface VerificationInput {
  text: string;
  features: Features;
  maxClaims: number;
}

export type VerifyFn = (input: VerificationInput) => Promise<VerificationResult>;

export interface VerifyTurnDeps {
  broker: SearchBroker;
  judgeCandidates: Candidate[];
  judgeFn: JudgeFn;
  drafterFamily?: ModelFamily;
  breakers?: BreakerRegistry;
  clock?: { now(): number };
}