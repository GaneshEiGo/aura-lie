// packages/search-broker/src/types.ts
// PRD 8.5, 8.6, 12.3 — pool, claim, and outcome shapes.

export type PoolId =
  | 'wikipedia'
  | 'wikidata'
  | 'arxiv'
  | 'crossref'
  | 'pubmed'
  | 'gemini-grounding'
  | 'tavily'
  | 'exa'
  | 'serper'
  | 'jina';

export type RiskTier = 0 | 1 | 2 | 3;
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type ClaimKind =
  | 'entity'
  | 'definition'
  | 'science'
  | 'general'
  | 'high-risk';

export type VerifyStatus =
  | 'verified'
  | 'unverified'
  | 'recall-only'
  | 'consent-required'
  | 'no-route'
  | 'skipped-tier-0';

export interface Clock {
  now(): number;
}

export interface BrokerClaim {
  claimId: string;
  text: string;
  kind: ClaimKind;
  riskTier: RiskTier;
  sensitivity: Sensitivity;
  minSources?: number;
  userApprovedExternalSearch?: boolean;
}

export interface SourceResult {
  poolId: PoolId;
  url: string;
  title?: string;
  snippet?: string;
}

export interface SearchProvider {
  search(poolId: PoolId, query: string): Promise<SourceResult | null>;
}

export interface PoolConfig {
  id: PoolId;
  priority: number;
  costPerQuery: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  monthlyReserveUntilDay?: number;
  monthlyReserveAmount?: number;
  totalLimit?: number;
  throttle?: { limit: number; windowMs: number };
}

export interface PoolState {
  usedToday: number;
  usedThisMonth: number;
  totalUsed: number;
  dayStart: number;
  monthStart: number;
  recentRequestsAt: number[];
}

export type ReserveReason =
  | 'ok'
  | 'daily-limit'
  | 'monthly-limit'
  | 'monthly-reserve'
  | 'total-exhausted'
  | 'throttled'
  | 'unknown-pool';

export interface ReserveResult {
  ok: boolean;
  reason: ReserveReason;
}

export interface BrokerAttempt {
  poolId: PoolId;
  outcome: 'success' | 'empty' | 'skipped-quota' | 'skipped-throttle' | 'error';
  reason?: string;
  at: number;
}

export interface VerifyOutcome {
  claimId: string;
  status: VerifyStatus;
  poolsTried: PoolId[];
  sources: SourceResult[];
  attempts: BrokerAttempt[];
  reason?: string;
}

export interface VerificationSummary {
  outcomes: VerifyOutcome[];
  checked: number;
  checkable: number;
  recallOnly: number;
  consentRequired: number;
  message: string;
}

export interface QueuedClaim {
  claimId: string;
  text: string;
  kind: ClaimKind;
  riskTier: RiskTier;
  sensitivity: Sensitivity;
  minSources?: number;
  userApprovedExternalSearch?: boolean;
  enqueuedAt: number;
}