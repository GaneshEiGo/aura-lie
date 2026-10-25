// packages/cost-guard/src/ledger.ts
// PRD 4.7 §3 + 12.7 Layer 3: "usage_ledger.cost_inr has CHECK (cost_inr = 0)."

import type { LedgerRow } from './types.js';
import { CostGuardViolationError, ViolationLogger } from './violations.js';

export interface ZeroCostLedgerOptions {
  logger: ViolationLogger;
  clock?: { now(): number };
}

export class ZeroCostLedger {
  private readonly rows: LedgerRow[] = [];
  private readonly logger: ViolationLogger;
  private readonly clock: { now(): number };

  constructor(options: ZeroCostLedgerOptions) {
    this.logger = options.logger;
    this.clock = options.clock ?? { now: () => Date.now() };
  }

  /**
   * Strictly records one call at £0.00. Any attempt to write a non-zero
   * cost throws `CostGuardViolationError` and writes to the audit log;
   * the ledger row is never created.
   */
  recordCall(row: LedgerRow): LedgerRow {
    if (typeof row.costInr !== 'number' || row.costInr !== 0) {
      const err = new CostGuardViolationError({
        kind: 'non-zero-cost',
        host: row.provider,
        reason: `attempted ledger write with costInr = ${row.costInr}`,
        at: this.clock.now(),
      });
      this.logger.record({
        at: err.at,
        adapter: row.provider,
        host: row.provider,
        reason: err.reason,
        kind: err.kind,
      });
      throw err;
    }

    const stored: LedgerRow = { ...row, costInr: 0 };
    this.rows.push(stored);
    return { ...stored };
  }

  /** T-01: the ledger stays pure. Only returns zero-cost rows. */
  all(): LedgerRow[] {
    return this.rows.map((r) => ({ ...r }));
  }

  totalCostInr(): 0 {
    return 0;
  }

  size(): number {
    return this.rows.length;
  }
}