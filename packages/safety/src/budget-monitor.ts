/**
 * PRD Section 13.9: Laptop Safety Budget (T-13).
 * Enforces memory limits and prevents heavy background CPU usage.
 */
export interface BudgetLimits {
  maxIdleMemoryMb: number;
  maxCpuPercent: number;
}

export class BudgetMonitor {
  private readonly LIMITS: BudgetLimits = {
    maxIdleMemoryMb: 150,
    maxCpuPercent: 1.0
  };

  public checkMemoryUsage(usedMb: number): { withinBudget: boolean, message: string } {
    if (usedMb > this.LIMITS.maxIdleMemoryMb) {
      return {
        withinBudget: false,
        message: `Memory usage (${usedMb} MB) exceeds the safe limit of ${this.LIMITS.maxIdleMemoryMb} MB. Prune cache.`
      };
    }
    return { withinBudget: true, message: 'Memory within safe limits.' };
  }

  public checkCpuUsage(cpuPercent: number): { withinBudget: boolean, message: string } {
    if (cpuPercent > this.LIMITS.maxCpuPercent) {
      return {
        withinBudget: false,
        message: `CPU usage (${cpuPercent}%) exceeds the safe limit of ${this.LIMITS.maxCpuPercent}%. Throttling background tasks.`
      };
    }
    return { withinBudget: true, message: 'CPU within safe limits.' };
  }
}