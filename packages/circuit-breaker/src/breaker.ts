// packages/circuit-breaker/src/breaker.ts
// PRD 7.8: "Circuit breaker per provider and model: open after 3 failures
// in 60 seconds, half-open after 90 seconds with one probe call, close
// after 2 successes."
//
// State machine:
//   closed    ──(3 failures within 60s)──▶ open
//   open      ──(90s elapsed)──────────▶ half-open
//   half-open ──(2 successes)──────────▶ closed
//   half-open ──(1 failure)────────────▶ open (cooldown restarts)

import type { BreakerConfig, CircuitState, Clock } from './types.js';

const DEFAULTS: Required<BreakerConfig> = {
  failureThreshold: 3,
  failureWindowMs: 60_000,
  openDurationMs: 90_000,
  halfOpenSuccesses: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureTimes: number[] = [];
  private openedAt: number | null = null;
  private halfOpenSuccessCount = 0;
  private readonly cfg: Required<BreakerConfig>;
  private readonly clock: Clock;

  constructor(config: BreakerConfig = {}, clock?: Clock) {
    this.cfg = { ...DEFAULTS, ...config };
    this.clock = clock ?? { now: () => Date.now() };
  }

  getState(): CircuitState {
    this.maybePromote();
    return this.state;
  }

  canAttempt(): boolean {
    this.maybePromote();
    return this.state !== 'open';
  }

  recordSuccess(): void {
    this.maybePromote();
    if (this.state === 'half-open') {
      this.halfOpenSuccessCount += 1;
      if (this.halfOpenSuccessCount >= this.cfg.halfOpenSuccesses) {
        this.state = 'closed';
        this.failureTimes = [];
        this.halfOpenSuccessCount = 0;
        this.openedAt = null;
      }
    }
    // closed: no-op
  }

  recordFailure(): void {
    this.maybePromote();
    const now = this.clock.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = now;
      this.halfOpenSuccessCount = 0;
      return;
    }

    // closed state: append + prune failures outside the window
    this.failureTimes.push(now);
    this.failureTimes = this.failureTimes.filter(
      (t) => now - t < this.cfg.failureWindowMs,
    );
    if (this.failureTimes.length >= this.cfg.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
      this.failureTimes = [];
      this.halfOpenSuccessCount = 0;
    }
  }

  /** Reset to a clean closed state (e.g. kill-switch resume). */
  reset(): void {
    this.state = 'closed';
    this.failureTimes = [];
    this.openedAt = null;
    this.halfOpenSuccessCount = 0;
  }

  private maybePromote(): void {
    if (this.state !== 'open' || this.openedAt === null) return;
    if (this.clock.now() - this.openedAt >= this.cfg.openDurationMs) {
      this.state = 'half-open';
      this.halfOpenSuccessCount = 0;
    }
  }
}

/**
 * A registry of one breaker per model family. The router keys breakers by
 * family (PRD 7.8 "per provider and model"; family-level is a coarser but
 * safe mapping that prevents one bad model in a family from being retried).
 */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly config: BreakerConfig;
  private readonly clock: Clock;

  constructor(config: BreakerConfig = {}, clock?: Clock) {
    this.config = config;
    this.clock = clock ?? { now: () => Date.now() };
  }

  for(family: string): CircuitBreaker {
    let b = this.breakers.get(family);
    if (!b) {
      b = new CircuitBreaker(this.config, this.clock);
      this.breakers.set(family, b);
    }
    return b;
  }

  canAttempt(family: string): boolean {
    return this.for(family).canAttempt();
  }

  recordSuccess(family: string): void {
    this.for(family).recordSuccess();
  }

  recordFailure(family: string): void {
    this.for(family).recordFailure();
  }

  getState(family: string): CircuitState {
    return this.for(family).getState();
  }

  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }
}