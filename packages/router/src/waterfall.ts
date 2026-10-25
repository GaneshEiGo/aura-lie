export class CircuitBreaker {
  private failures: Map<string, { count: number, lastFail: number, state: 'closed'|'open'|'half-open' }> = new Map();

  public isAvailable(providerId: string): boolean {
    const breaker = this.failures.get(providerId);
    if (!breaker) return true; // Default closed
    
    if (breaker.state === 'open') {
      // After 90s, transition to half-open
      if (Date.now() - breaker.lastFail > 90_000) {
        breaker.state = 'half-open';
        this.failures.set(providerId, breaker);
        return true;
      }
      return false; // Still open
    }
    return true;
  }

  public recordSuccess(providerId: string): void {
    const breaker = this.failures.get(providerId);
    if (breaker && breaker.state === 'half-open') {
      breaker.count++;
      if (breaker.count >= 2) {
        breaker.state = 'closed';
        breaker.count = 0;
      }
      this.failures.set(providerId, breaker);
    } else {
      this.failures.set(providerId, { count: 0, lastFail: 0, state: 'closed' });
    }
  }

  public recordFailure(providerId: string): void {
    const breaker = this.failures.get(providerId) || { count: 0, lastFail: 0, state: 'closed' };
    breaker.count++;
    breaker.lastFail = Date.now();
    
    // 3 failures in 60s opens the circuit
    if (breaker.count >= 3) {
      breaker.state = 'open';
    }
    this.failures.set(providerId, breaker);
  }
}

/**
 * Executes a task against a chain of providers.
 */
export async function executeWithWaterfall<T>(
  chain: string[],
  breaker: CircuitBreaker,
  task: (providerId: string) => Promise<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (const providerId of chain) {
    if (!breaker.isAvailable(providerId)) {
      continue; // Skip blocked providers
    }

    try {
      const result = await task(providerId);
      breaker.recordSuccess(providerId);
      return result;
    } catch (err: any) {
      breaker.recordFailure(providerId);
      lastError = err;
    }
  }

  throw lastError || new Error('All providers in waterfall failed');
}