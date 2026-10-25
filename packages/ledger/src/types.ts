export type ClaimStatus = 'VERIFIED' | 'SUPPORTED' | 'MIXED' | 'WEAK' | 'CONFLICTED' | 'UNVERIFIED' | 'RECALL_ONLY';

export interface ScoreHistoryEntry {
  score: number;
  status: ClaimStatus;
  timestamp: number;
  reason: string;
}

export interface LedgerClaim {
  id: string;
  text: string;
  status: ClaimStatus;
  score: number | null;
  history: ScoreHistoryEntry[];
  lastChecked: number;
}