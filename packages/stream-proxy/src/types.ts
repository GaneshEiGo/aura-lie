// packages/stream-proxy/src/types.ts
// PRD 7.7 (streaming protocol), PRD 7.15 (adapter), Appendix C (ChatEvent).

export type Mode = 'instant' | 'think' | 'research' | 'council';
export type LoopClass = 'light' | 'standard' | 'deep';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type RiskTier = 0 | 1 | 2 | 3;

export type ClaimStatus =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CONFLICTED'
  | 'UNVERIFIED'
  | 'RECALL_ONLY'
  | 'NOT_SCORED';

export type MessageChip =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CHECK'
  | 'PARTIAL'
  | 'RECALL-ONLY';

export interface MetaRoute {
  role: string;
  family: string;
}

export interface PoolSnapshot {
  pool: string;
  used: number;
  planningLimit: number;
  blockedUntil?: string;
  resetsAt?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  turnId: string;
  model: string;
  messages: ChatMessage[];
  mode: Mode;
  sensitivity: Sensitivity;
  maxTokens?: number;
}

/**
 * Provider-side event, per PRD 7.15: "ChatEvent carries reasoning, content,
 * usage, rate limit and finish parts." `subrequest` is an internal marker
 * the pipeline can inject to record an external call against the budget.
 */
export type ProviderChatEvent =
  | {
      kind: 'reasoning';
      delta: string;
      provider: string;
      model: string;
      format: 'summary' | 'raw';
    }
  | { kind: 'content'; delta: string }
  | { kind: 'usage'; promptTokens: number; completionTokens: number }
  | {
      kind: 'rateLimit';
      rpmLeft?: number;
      rpdLeft?: number;
      resetsAt?: string;
    }
  | {
      kind: 'finish';
      reason: 'stop' | 'length' | 'tool_use' | 'error';
      errorCode?: string;
    }
  | { kind: 'subrequest'; cost: number };

export interface ProviderAdapter {
  id: string;
  lane: 'private' | 'training-risk';
  chat(req: ChatRequest): AsyncIterable<ProviderChatEvent>;
}

/**
 * Client-side event, exactly matching Appendix C's ChatEvent union.
 */
export type ChatEvent =
  | {
      t: 'meta';
      v: 1;
      turnId: string;
      mode: Mode;
      persona: string;
      route: MetaRoute;
      sensitivity: Sensitivity;
      riskTier: RiskTier;
    }
  | {
      t: 'trace';
      seq: number;
      tMs: number;
      type: string;
      text: string;
      data?: unknown;
    }
  | {
      t: 'thinking';
      delta: string;
      provider: string;
      model: string;
      kind: 'summary' | 'raw';
    }
  | { t: 'token'; delta: string }
  | {
      t: 'claim';
      id: string;
      text: string;
      claimType: string;
      importance: number;
    }
  | {
      t: 'source';
      id: string;
      title: string;
      domain: string;
      tier: number;
      published?: string;
      independenceGroup: string;
    }
  | {
      t: 'quote';
      sourceId: string;
      claimId: string;
      text: string;
      matchOk: boolean;
    }
  | {
      t: 'score';
      claimId: string;
      score: number | null;
      status: ClaimStatus;
      factors: Record<string, number>;
      caps: string[];
      penalties: number;
    }
  | {
      t: 'summary';
      overall: number | null;
      checked: number;
      checkable: number;
      chip: MessageChip;
      heuristic: boolean;
    }
  | { t: 'memory_used'; memoryId: string; why: string }
  | { t: 'quota'; pools: PoolSnapshot[] }
  | {
      t: 'approval';
      id: string;
      action: string;
      dryRun: string;
      permissionClass: string;
    }
  | { t: 'continue'; stepToken: string; reason: string }
  | {
      t: 'notice';
      severity: 'info' | 'warn' | 'error';
      code: string;
      text: string;
    }
  | { t: 'done'; elapsedMs: number; calls: number; tokens: number; costInr: 0 }
  | { t: 'error'; code: string; userMessage: string; retryHint?: string };

export interface ProxyOptions {
  clock?: { now(): number };
  maxSubrequests?: number;
  meta: {
    persona: string;
    route: MetaRoute;
    riskTier: RiskTier;
    mode: Mode;
  };
}

export interface ProxyResult {
  turnId: string;
  events: ChatEvent[];
  bytesIn: number;
  bytesOut: number;
  promptTokens: number;
  completionTokens: number;
  subrequestsUsed: number;
  subrequestsBudget: number;
  exhausted: boolean;
  errored: boolean;
  durationMs: number;
}