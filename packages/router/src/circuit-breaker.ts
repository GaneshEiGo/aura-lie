/**
 * PRD Section 7.8: Circuit breaker per provider and model.
 * Open after 3 failures in 60s. Half-open after 90s. Close after 2 successes.
 */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private successes = 0;
  
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RESET_TIMEOUT_MS = 90000;
  private readonly SUCCESS_THRESHOLD = 2;

  public isAvailable(): boolean {
    if (this.state === 'CLOSED') return true;
    
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.RESET_TIMEOUT_MS) {
        this.state = 'HALF_OPEN';
        this.successes = 0;
        return true;
      }
      return false;
    }
    
    return true; // HALF_OPEN allows probe calls
  }

  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.SUCCESS_THRESHOLD) {
        this.state = 'CLOSED';
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  public recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.FAILURE_THRESHOLD || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }
}