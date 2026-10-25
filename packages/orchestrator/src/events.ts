/**
 * PRD Appendix C: Event and Type Definitions (TypeScript excerpt)
 * Strict union type for Server-Sent Events (SSE).
 */

export type Lane = 'private' | 'training-risk';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type Mode = 'instant' | 'think' | 'research' | 'council';
export type Origin = 'USER' | 'FILE' | 'WEB' | 'MODEL' | 'DERIVED' | 'INFERRED' | 'UNKNOWN';
export type ClaimStatus = 'VERIFIED' | 'SUPPORTED' | 'MIXED' | 'WEAK' | 'CONFLICTED' | 'UNVERIFIED' | 'RECALL_ONLY' | 'NOT_SCORED';

export interface PoolSnapshot {
  pool: string;
  used: number;
  planningLimit: number;
  blockedUntil?: string;
  resetsAt?: string;
}

export type ChatEvent =
  | {
      t: 'meta';
      v: 1;
      turnId: string;
      mode: Mode;
      persona: string;
      route: { role: string; family: string };
      sensitivity: Sensitivity;
      riskTier: 0 | 1 | 2 | 3;
    }
  | { t: 'trace'; seq: number; tMs: number; type: string; text: string; data?: unknown }
  | { t: 'thinking'; delta: string; provider: string; model: string; kind: 'summary' | 'raw' }
  | { t: 'token'; delta: string }
  | { t: 'claim'; id: string; text: string; claimType: string; importance: number }
  | { t: 'source'; id: string; title: string; domain: string; tier: number; published?: string; independenceGroup: string }
  | { t: 'quote'; sourceId: string; claimId: string; text: string; matchOk: boolean }
  | { t: 'score'; claimId: string; score: number | null; status: ClaimStatus; factors: Record<string, number>; caps: string[]; penalties: number }
  | { t: 'summary'; overall: number | null; checked: number; checkable: number; chip: 'VERIFIED' | 'SUPPORTED' | 'MIXED' | 'WEAK' | 'CHECK' | 'PARTIAL' | 'RECALL-ONLY'; heuristic: boolean }
  | { t: 'memory_used'; memoryId: string; why: string }
  | { t: 'quota'; pools: PoolSnapshot[] }
  | { t: 'approval'; id: string; action: string; dryRun: string; permissionClass: string }
  | { t: 'continue'; stepToken: string; reason: string }
  | { t: 'notice'; severity: 'info' | 'warn' | 'error'; code: string; text: string }
  | { t: 'done'; elapsedMs: number; calls: number; tokens: number; costInr: 0 }
  | { t: 'error'; code: string; userMessage: string; retryHint?: string };

export interface ChatRequest {
  message: string;
  mode: Mode;
  persona: string;
  thinking: boolean;
}