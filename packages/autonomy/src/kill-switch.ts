// === FILE START ===
// packages/autonomy/src/kill-switch.ts
// PRD §10.10 · F-082 · FR-PRO-11 · T-10.
//
// One-tap pause. Every cron tick and mission step MUST go through
// `runIfAllowed` (throws when paused) or `tryRun` (returns { executed: false }).
// T-10 verifies that pausing halts every simulated cron compose and mission
// step immediately — the "within 60 seconds" window in the PRD refers to the
// production cron cadence (15 min), not to the check itself, which is instant.
//
// Persistence model: the D1 flag from the PRD is represented by any
// KillSwitchBackend. `createInMemoryBackend()` is the test-friendly one; a
// D1-backed adapter would call the same two methods against a row.

export interface KillSwitchBackend {
  isPaused(): Promise<boolean>;
  setPaused(paused: boolean): Promise<void>;
}

export function createInMemoryBackend(): KillSwitchBackend {
  let paused = false;
  return {
    async isPaused() { return paused; },
    async setPaused(p: boolean) { paused = p; },
  };
}

export class KillSwitchPaused extends Error {
  readonly kind = 'KillSwitchPaused';
  constructor(message = 'Kill switch is active. Resume autonomy first.') {
    super(message);
    this.name = 'KillSwitchPaused';
  }
}

export class KillSwitch {
  private readonly backend: KillSwitchBackend;

  constructor(backend: KillSwitchBackend = createInMemoryBackend()) {
    this.backend = backend;
  }

  async pause(): Promise<void> { await this.backend.setPaused(true); }
  async resume(): Promise<void> { await this.backend.setPaused(false); }
  async isPaused(): Promise<boolean> { return this.backend.isPaused(); }

  /**
   * Throwing variant. Use this as the FIRST line of any cron tick,
   * mission step, push compose, or agent action.
   */
  async runIfAllowed<R>(fn: () => Promise<R> | R): Promise<R> {
    if (await this.backend.isPaused()) {
      throw new KillSwitchPaused();
    }
    return await fn();
  }

  /**
   * Non-throwing variant. Returns { executed: false } when paused.
   */
  async tryRun<R>(
    fn: () => Promise<R> | R,
  ): Promise<
    | { executed: true; value: R }
    | { executed: false; reason: 'paused' }
  > {
    if (await this.backend.isPaused()) {
      return { executed: false, reason: 'paused' };
    }
    return { executed: true, value: await fn() };
  }
}
// === FILE END ===