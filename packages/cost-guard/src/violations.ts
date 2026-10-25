// packages/cost-guard/src/violations.ts
// PRD 12.7: "If layer 1 or 3 trips, the request is blocked and a row is
// written to audit_log with action COST_GUARD_VIOLATION, the adapter and
// the attempted host. The ledger table itself stays pure (zeros only)."

import type { AuditViolation, ViolationKind } from './types.js';

export class CostGuardViolationError extends Error {
  readonly kind: ViolationKind;
  readonly host: string;
  readonly reason: string;
  readonly at: number;

  constructor(input: {
    kind: ViolationKind;
    host: string;
    reason: string;
    at?: number;
  }) {
    super(`Cost Guard violation (${input.kind}): ${input.reason}`);
    this.name = 'CostGuardViolationError';
    this.kind = input.kind;
    this.host = input.host;
    this.reason = input.reason;
    this.at = input.at ?? Date.now();
  }
}

/**
 * Append-only in-memory audit log for violations. In production this writes
 * to `audit_violations` (Appendix D.3); the ledger table never sees them.
 */
export class ViolationLogger {
  private rows: AuditViolation[] = [];
  private counter = 0;

  record(input: {
    at: number;
    adapter: string;
    host: string;
    reason: string;
    kind: ViolationKind;
  }): AuditViolation {
    this.counter += 1;
    const violation: AuditViolation = {
      id: `violation-${this.counter.toString().padStart(6, '0')}`,
      at: input.at,
      adapter: input.adapter,
      host: input.host,
      reason: input.reason,
      kind: input.kind,
    };
    this.rows.push(violation);
    return { ...violation };
  }

  all(): AuditViolation[] {
    return this.rows.map((v) => ({ ...v }));
  }

  byKind(kind: ViolationKind): AuditViolation[] {
    return this.rows.filter((v) => v.kind === kind).map((v) => ({ ...v }));
  }

  size(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
    this.counter = 0;
  }
}