/**
 * PRD Section 13.6: Quota ledger algorithm
 */
export interface PoolState {
  used: number;
  limit: number;
  resetAt?: number;
}

export class QuotaLedger {
  private pools: Record<string, PoolState>;

  constructor(config: Record<string, PoolState>) {
    this.pools = config;
  }

  public reserve(poolName: string, amount: number): boolean {
    const pool = this.pools[poolName];
    if (!pool) return false;
    
    if (pool.used + amount > pool.limit) {
      return false;
    }
    
    pool.used += amount;
    return true;
  }

  public getRemaining(poolName: string): number {
    const pool = this.pools[poolName];
    if (!pool) return 0;
    return Math.max(0, pool.limit - pool.used);
  }
}