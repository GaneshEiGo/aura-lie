// packages/orchestrator-core/src/types.ts
// PRD 7.1, 7.2 + Appendix C.

import type {
  Candidate,
  Features,
  ModelFamily,
  ModelRegistry,
  ModelRole,
  RoutingResult,
} from '@aura-lie/router-engine';
import type {
  BreakerLike,
} from '@aura-lie/router-engine';
import type {
  ChatEvent,
  ChatRequest,
  ProviderAdapter,
  Sensitivity,
  Mode,
} from '@aura-lie/stream-proxy';
import type {
  QuotaLedger,
  Reservation,
  Purpose,
} from '@aura-lie/quota-ledger';

export type { Candidate, Features, ModelFamily, ChatEvent };

export type TurnMode = Mode;

export interface TurnRequest {
  turnId: string;
  /** The user's raw message. */
  text: string;
  /** Optional explicit mode override; else derived from features.loop. */
  mode?: TurnMode;
  /** Optional persona label; default `Aura-lie`. */
  persona?: string;
  /** Optional sensitivity override; else from features.sensitivityHint. */
  sensitivity?: Sensitivity;
  /** Optional risk tier override; else from features.riskTier. */
  riskTier?: 0 | 1 | 2 | 3;
  /** Per-request subrequest budget override (PRD 13.3). */
  maxSubrequests?: number;
}

// -----------------------------------------------------------------------------
// Verification interface — the caller wires truth + search-broker together.
// -----------------------------------------------------------------------------

export interface VerifiedSource {
  id: string;
  title: string;
  domain: string;
  tier: number;
  published?: string;
  independenceGroup: string;
  /** 25-word max, verbatim from fetched page (PRD 8.4). */
  quote: string;
  /** PRD 8.4: quote must be a substring; if false, citation is dropped. */
  matchOk: boolean;
}

export interface VerifiedClaim {
  id: string;
  text: string;
  type: string;
  /** PRD 8.2: "central" | "supporting" or 0.7-1.0 numeric. */
  importance: number | 'central' | 'supporting';
  /** null when the claim is RECALL_ONLY / NOT_SCORED (PRD 8.2). */
  score: number | null;
  status:
    | 'VERIFIED'
    | 'SUPPORTED'
    | 'MIXED'
    | 'WEAK'
    | 'CONFLICTED'
    | 'UNVERIFIED'
    | 'RECALL_ONLY'
    | 'NOT_SCORED';
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
  /** PRD 8.6: how many claims the caller may verify for this risk tier. */
  maxClaims: number;
}

export type VerifyFn = (input: VerificationInput) => Promise<VerificationResult>;

// -----------------------------------------------------------------------------
// Dependencies
// -----------------------------------------------------------------------------

export interface LedgerLike {
  reserve(pool: string, est: number, purpose: Purpose): { ok: boolean; token?: Reservation; reason?: string };
  commit(tokenId: string, actual: number): void;
}

export interface CurateFn {
  (req: TurnRequest, verification: VerificationResult | undefined): Promise<void> | void;
}

export interface TurnDeps {
  /** One adapter per model family. Missing family → that candidate fails. */
  adapters: Partial<Record<ModelFamily, ProviderAdapter>>;

  /** Optional: circuit-breaker registry; when omitted, no breaker filtering. */
  breakers?: BreakerLike;

  /** Optional: quota ledger; when omitted, no quota tracking. */
  ledger?: LedgerLike;

  /** Optional: headroom per family; passed to router. */
  headroom?: (family: ModelFamily) => number;

  /** Optional: model registry; defaults to `createDefaultRegistry()`. */
  registry?: ModelRegistry;

  /** Optional: verification step (wraps truth + search-broker). */
  verify?: VerifyFn;

  /** Optional: memory curation (memory-curator) — fire-and-forget. */
  curate?: CurateFn;

  /** Optional: clock for tests. */
  clock?: { now(): number };
}

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

export interface TurnResult {
  turnId: string;
  events: ChatEvent[];
  features: Features;
  candidates: Candidate[];
  winner?: Candidate;
  verification?: VerificationResult;
  durationMs: number;
  bytesOut: number;
  /** Convenience for tests. */
  routing?: RoutingResult;
  /** Convenience for tests. */
  role: ModelRole;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** PRD 8.6: max claims checked per risk tier. */
export const CLAIMS_PER_TIER: Record<0 | 1 | 2 | 3, number> = {
  0: 0,
  1: 3,
  2: 6,
  3: 8,
};