// packages/kill-switch-audit/src/kill-switch.ts
// PRD 10.4, 10.10, F-082, T-10. The single-tap pause.

import type {
  AuditInput,
  KillSwitchOptions,
  KillSwitchState,
  PauseHook,
} from './types.js';

const DEFAULT_STATE: KillSwitchState = {
  paused: false,
  pausedAt: null,
  pausedBy: null,
  reason: null,
};

export class KillSwitch {
  private state: KillSwitchState;
  private readonly clock: { now(): number };
  private readonly audit?: { record(input: AuditInput): unknown };
  private readonly pauseHooks: PauseHook[] = [];

  constructor(options: KillSwitchOptions = {}) {
    this.state = { ...DEFAULT_STATE, ...(options.initial ?? {}) };
    this.clock = options.clock ?? { now: () => Date.now() };
    this.audit = options.audit;
  }

  /** PRD 10.4: the flag checked first on every tick and every mission step. */
  isActive(): boolean {
    return this.state.paused;
  }

  /** Inverse of `isActive()` — reads naturally in guard clauses. */
  canRun(): boolean {
    return !this.state.paused;
  }

  /** Throws if paused. Useful for fail-fast at the top of worker steps. */
  assertActive(): void {
    if (this.state.paused) {
      throw new KillSwitchActiveError(
        `Autonomy paused${this.state.reason ? `: ${this.state.reason}` : ''}`,
      );
    }
  }

  /**
   * Run `fn` only if the kill switch is active. Otherwise return null.
   * Synchronous + async both supported; return type mirrors `fn`.
   */
  async runIfActive<T>(fn: () => T | Promise<T>): Promise<T | null> {
    if (this.state.paused) return null;
    return await fn();
  }

  /** PRD 10.10: "The first line of every cron job and mission step…" */
  async pause(actor: string, reason: string): Promise<void> {
    if (this.state.paused) return;
    this.state = {
      paused: true,
      pausedAt: this.clock.now(),
      pausedBy: actor,
      reason,
    };
    this.audit?.record({
      action: 'kill_switch_pause',
      actor,
      reason,
      result: 'success',
      outputSummary: 'autonomy paused',
    });
    await this.fireHooks();
  }

  /** PRD 10.10: "One tap resumes." */
  async resume(actor: string, reason: string): Promise<void> {
    if (!this.state.paused) return;
    this.state = {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      reason,
    };
    this.audit?.record({
      action: 'kill_switch_resume',
      actor,
      reason,
      result: 'success',
      outputSummary: 'autonomy resumed',
    });
  }

  /** PRD 10.10: cancel queued composes when paused. */
  onPause(hook: PauseHook): () => void {
    this.pauseHooks.push(hook);
    return () => {
      const idx = this.pauseHooks.indexOf(hook);
      if (idx !== -1) this.pauseHooks.splice(idx, 1);
    };
  }

  /** Current persisted state (a clone). */
  snapshot(): KillSwitchState {
    return { ...this.state };
  }

  private async fireHooks(): Promise<void> {
    for (const hook of this.pauseHooks) {
      try {
        await hook();
      } catch {
        // PRD 10.10: never let a hook failure block pause.
      }
    }
  }
}

export class KillSwitchActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KillSwitchActiveError';
  }
}