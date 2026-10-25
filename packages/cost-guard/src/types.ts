// packages/cost-guard/src/types.ts
// PRD 4.7, 12.7, Appendix D.3, H.5.

export type ViolationKind =
  | 'denied-host'      // Layer 1: host not on allow-list
  | 'billing-endpoint' // Layer 1: path matches the billing deny-list
  | 'non-zero-cost'    // Layer 3: attempted to write cost_inr > 0
  | 'paid-sdk'         // Layer 2: import of a paid SDK
  | 'paid-env'         // Layer 2: reference to a paid-tier env var
  | 'paid-model-flag'; // Layer 2: { paid: true } on a model

export interface AuditViolation {
  // Appendix D.3: audit_violations columns
  // (id, at, adapter, host, reason) + `kind` for routing
  id: string;
  at: number;
  adapter: string;
  host: string;
  reason: string;
  kind: ViolationKind;
}

export interface LedgerRow {
  at: number;
  provider: string;
  model: string;
  tokens: number;
  /** PRD 4.7 §3: `CHECK (cost_inr = 0)` — enforced by the ledger class. */
  costInr: number;
}

export interface AllowRule {
  /** Exact host or `*.suffix` wildcard. */
  host: string;
  /** Optional path-prefix allow-list; undefined = whole host. */
  paths?: string[];
}

export interface EgressPolicy {
  allow: AllowRule[];
  deny: {
    /** Hosts on the hard deny-list (billing SDKs, checkout pages). */
    hosts: string[];
    /** Substrings matched against the URL pathname. */
    pathSubstrings: string[];
  };
}

export interface ReceiptMonth {
  month: string;    // e.g. "2026-10"
  replies: number;
  calls: number;
  /** F-259: always 0. Typed as literal. */
  costInr: 0;
}

export interface ProviderNoCardCheck {
  provider: string;
  verified: 'verified' | 'not-verified' | 'unknown';
  checkedAt: number;
}

export interface NoCardAuditResult {
  providers: ProviderNoCardCheck[];
  allVerified: boolean;
  failedProviders: string[];
}

export interface CiScanViolation {
  file: string;
  kind: ViolationKind;
  match: string;
  reason: string;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;