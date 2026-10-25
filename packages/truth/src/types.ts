// packages/truth/src/types.ts
// PRD 8.8 status labels + Appendix C ClaimStatus union.

export type ClaimStatus =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CONFLICTED'
  | 'UNVERIFIED'
  | 'RECALL_ONLY'
  | 'NOT_SCORED';

export type ClaimBand =
  | 'verified'
  | 'supported'
  | 'mixed'
  | 'weak'
  | 'conflicted'
  | 'recall-only';

export type ClaimImportance = 'central' | 'supporting';

export interface ScoreFactors {
  S?: number;
  E?: number;
  A?: number;
  F?: number;
  C?: number;
}

export interface ScoredClaim {
  score: number;
  status: ClaimStatus;
  band: ClaimBand;
  capsApplied: string[];
  importance?: ClaimImportance;
}

export interface ResponseSummary {
  overall: number | null;
  chip: string;
  checked: number;
}

export interface RawFactors extends ScoreFactors {}

export interface ClaimForScoring extends ScoreFactors {
  id?: string;
  text?: string;
  messageId?: string;
  type?: string;
  importance?: ClaimImportance | number;

  score?: number;
  factScore?: number;
  fact_score?: number;
  value?: number;
  status?: ClaimStatus;
  band?: ClaimBand;

  contradictionPenalty?: number;
  contradiction_penalty?: number;
  contradictionPenaltyPoints?: number;
  penalty?: number;
  penalties?: number;
  hasStrongContradiction?: boolean;
  has_strong_contradiction?: boolean;
  strongContradiction?: boolean;
  strong_contradiction?: boolean;

  quoteMatchFailed?: boolean;
  quote_match_failed?: boolean;
  quoteMatch?: boolean;
  quote_match?: boolean;
  quoteValid?: boolean;
  quote_valid?: boolean;
  matchOk?: boolean;
  match_ok?: boolean;
  isQuoteVerified?: boolean;
  is_quote_verified?: boolean;
  hasSource?: boolean;
  has_source?: boolean;
  sourceAvailable?: boolean;
  source_available?: boolean;

  isInterestedParty?: boolean;
  interested_party?: boolean;
  interestedParty?: boolean;

  isCritical?: boolean;

  factors?: ScoreFactors;
  claim?: any;
  result?: any;

  [key: string]: any;
}