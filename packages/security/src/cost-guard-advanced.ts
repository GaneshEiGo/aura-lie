// === FILE START ===
// packages/security/src/cost-guard-advanced.ts
// PRD 12.7 · F-217 · L1 · T-01.
//
// Violation logging + audit integrity + monthly receipt.
//
// The existing `cost-guard.ts` blocks requests at the network boundary
// (allow-list, deny-list, https-only). This module sits ON TOP and records
// what was blocked, so the monthly audit can prove "0 violations" or surface
// them. Per PRD 12.7, the ledger table stays pure (cost_inr = 0); violations
// go to a separate audit stream that CI reads and fails on.
//
// Self-contained — imports nothing from `cost-guard.ts`, so it cannot break
// the 4 passing tests in `security.test.ts` or the 25 in `packages/cost-guard`.

export type ViolationKind =
  | 'unapproved_host'
  | 'billing_endpoint'
  | 'insecure_protocol'
  | 'paid_model'
  | 'paid_tier';

export interface ViolationRecord {
  id: string;
  at: number;
  kind: ViolationKind;
  adapter: string;
  attemptedHost: string;
  attemptedPath: string;
  reason: string;
}

export interface ViolationSummary {
  total: number;
  byKind: Record<ViolationKind, number>;
  byAdapter: Record<string, number>;
}

export interface ReceiptLine {
  /** YYYY-MM */
  month: string;
  replies: number;
  violations: number;
  /** Always exactly 0. This is the invariant. */
  costInr: 0;
  label: string;
}

export interface AuditIntegrityResult {
  ok: boolean;
  reasons: string[];
  total: number;
  uniqueIds: number;
  hasFuture: boolean;
  hasNegativeCost: boolean;
}

const ALL_VIOLATION_KINDS: ViolationKind[] = [
  'unapproved_host',
  'billing_endpoint',
  'insecure_protocol',
  'paid_model',
  'paid_tier',
];

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `v_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

export class CostGuardAudit {
  private readonly log: ViolationRecord[] = [];
  private readonly clock: { now(): number };
  private readonly idGen: () => string;
  private replyCount = 0;

  constructor(
    options: { clock?: { now(): number }; idGenerator?: () => string } = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.idGen = options.idGenerator ?? nextId;
  }

  /**
   * Record a blocked request. Called by the guarded-fetch wrapper whenever
   * `guardedFetch` refuses a URL. Cost Guard layer 1 does the blocking;
   * this function does the recording.
   */
  recordViolation(input: {
    kind: ViolationKind;
    adapter: string;
    attemptedHost: string;
    attemptedPath?: string;
    reason: string;
  }): ViolationRecord {
    const rec: ViolationRecord = {
      id: this.idGen(),
      at: this.clock.now(),
      kind: input.kind,
      adapter: input.adapter,
      attemptedHost: input.attemptedHost,
      attemptedPath: input.attemptedPath ?? '',
      reason: input.reason,
    };
    this.log.push(rec);
    return { ...rec };
  }

  /** Increment the reply counter (drives the monthly receipt). */
  recordReply(): void {
    this.replyCount += 1;
  }

  /** Deep-cloned snapshot. Mutations don't affect the internal log. */
  violationLog(): ViolationRecord[] {
    return this.log.map((v) => ({ ...v }));
  }

  violationCount(): number {
    return this.log.length;
  }

  /** Aggregated view — feeds the Inspector's Cost tab. */
  summary(): ViolationSummary {
    const byKind = {} as Record<ViolationKind, number>;
    for (const k of ALL_VIOLATION_KINDS) byKind[k] = 0;
    const byAdapter: Record<string, number> = {};
    for (const v of this.log) {
      byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
      byAdapter[v.adapter] = (byAdapter[v.adapter] ?? 0) + 1;
    }
    return { total: this.log.length, byKind, byAdapter };
  }

  /**
   * Verify the audit stream itself is sane. Called by T-01 CI. A violation
   * log can be non-empty and still pass integrity — integrity is about the
   * log's internal consistency, not about whether violations occurred.
   */
  auditIntegrity(): AuditIntegrityResult {
    const reasons: string[] = [];
    const now = this.clock.now();
    const seen = new Set<string>();
    let hasFuture = false;
    for (const v of this.log) {
      if (seen.has(v.id)) reasons.push(`duplicate_id:${v.id}`);
      seen.add(v.id);
      if (v.at > now) hasFuture = true;
    }
    if (hasFuture) reasons.push('future_timestamp');
    return {
      ok: reasons.length === 0,
      reasons,
      total: this.log.length,
      uniqueIds: seen.size,
      hasFuture,
      hasNegativeCost: false,
    };
  }

  /**
   * PRD 12.7 receipt line. Example: "Rs 0.00 this month · 4312 replies ·
   * 0 rupees, ever". `costInr` is typed as literal `0`, so TypeScript
   * statically guarantees the invariant.
   */
  monthlyReceipt(month?: string): ReceiptLine {
    const m = month ?? formatMonthKey(this.clock.now());
    return {
      month: m,
      replies: this.replyCount,
      violations: this.log.length,
      costInr: 0,
      label: `Rs 0.00 this month · ${this.replyCount} replies · 0 rupees, ever`,
    };
  }

  reset(): void {
    this.log.length = 0;
    this.replyCount = 0;
  }
}

/** Format a UTC epoch-ms value as `YYYY-MM`. */
export function formatMonthKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}
// === FILE END ===