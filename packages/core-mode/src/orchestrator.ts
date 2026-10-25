// === FILE START ===
// packages/core-mode/src/orchestrator.ts
// PRD 7.8 · F-250 · FR-CORE-02/03/04/05 · Section 70 adds crisis hook.
//
// When a `crisisGuard` is provided, every query is first passed through
// `detect()`. If the risk is medium or high, we return a crisis answer with
// region-appropriate resources — the query is NEVER queued as a promise.
// When `crisisGuard` is not provided (Section 69 behaviour), the flow is
// byte-for-byte identical to Section 69.

import { CoreModeEngine } from './engine.js';
import type { CoreModeResult, PendingPromise } from './engine.js';

// -----------------------------------------------------------------------------
// Crisis hooks — duck-typed so this module does not depend on @aura-lie/safety
// -----------------------------------------------------------------------------

export interface CrisisSignalLike {
  risk: 'none' | 'low' | 'medium' | 'high';
  reasons: string[];
  isFiction: boolean;
  isIdiom: boolean;
}

export interface CrisisResourceLike {
  name: string;
  number: string;
  region: string;
}

export interface CrisisResponseLike {
  message: string;
  resources: CrisisResourceLike[];
}

export interface CrisisGuardLike {
  detect(query: string): CrisisSignalLike;
  buildResponse(
    signal: CrisisSignalLike,
    opts?: { region?: string },
  ): CrisisResponseLike;
}

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type CoreModeAnswerType =
  | 'cache'
  | 'tool'
  | 'memory'
  | 'promise'
  | 'crisis';

export interface CoreModeAnswer {
  type: CoreModeAnswerType;
  /** Same as engine's `text` — string for tool/memory/promise/crisis, array for cache. */
  text: string | string[];
  /** Wall-clock time inside `answer()`. Always ≥ 0. */
  elapsedMs: number;
  /** Present only when `type === 'promise'`. */
  promiseId?: string;
  /** Present only when `type === 'crisis'`. */
  crisis?: {
    risk: 'low' | 'medium' | 'high';
    reasons: string[];
    resources: CrisisResourceLike[];
  };
}

export type BannerState =
  | 'idle'
  | 'core-mode'
  | 'offline'
  | 'quota-low'
  | 'promise-queued';

export interface CoreModeBanner {
  state: BannerState;
  message: string;
}

export interface CoreModeStats {
  total: number;
  pending: number;
  kept: number;
  broken: number;
  /** 0..1. Vacuously 1 when nothing has resolved. */
  keepRate: number;
}

export interface CoreModeOrchestratorOptions {
  clock?: { now(): number };
  crisisGuard?: CrisisGuardLike;
  /** Forwarded to crisisGuard.buildResponse(). */
  region?: string;
}

const BANNER_COPY: Record<BannerState, string> = {
  idle: '',
  'core-mode':
    "Cloud models are resting until 05:30 IST. I can still search your notes, calculate and set reminders, and I'll answer when they're back.",
  offline: "No internet. Showing what's on this device.",
  'quota-low':
    "The fast model is nearly used up today. I'll switch to the next one.",
  'promise-queued':
    "Queued. I'll answer when the models reset (about 3 h) and tell you.",
};

export class CoreModeOrchestrator {
  private readonly engine: CoreModeEngine;
  private readonly clock: { now(): number };
  private readonly crisisGuard: CrisisGuardLike | undefined;
  private readonly region: string | undefined;

  constructor(options: CoreModeOrchestratorOptions = {}) {
    this.engine = new CoreModeEngine();
    this.clock = options.clock ?? { now: () => Date.now() };
    this.crisisGuard = options.crisisGuard;
    this.region = options.region;
  }

  answer(query: string): CoreModeAnswer {
    const start = this.clock.now();

    // ── Section 70: crisis check FIRST. A crisis query is never queued.
    if (this.crisisGuard) {
      const signal = this.crisisGuard.detect(query);
      if (signal.risk === 'high' || signal.risk === 'medium') {
        const response = this.crisisGuard.buildResponse(signal, {
          region: this.region,
        });
        const elapsedMs = this.clock.now() - start;
        return {
          type: 'crisis',
          text: response.message,
          elapsedMs,
          crisis: {
            risk: signal.risk,
            reasons: signal.reasons.slice(),
            resources: response.resources.slice(),
          },
        };
      }
    }

    // ── Section 69 path (unchanged when no crisis trigger fires)
    const result: CoreModeResult = this.engine.process(query);
    const elapsedMs = this.clock.now() - start;

    if (result.type === 'promise') {
      const pending = this.engine.promises.getPending();
      const lastId =
        pending.length > 0 ? pending[pending.length - 1].id : undefined;
      return { type: 'promise', text: result.text, elapsedMs, promiseId: lastId };
    }

    return { type: result.type, text: result.text, elapsedMs };
  }

  banner(state: BannerState): CoreModeBanner {
    return { state, message: BANNER_COPY[state] };
  }

  hasPending(): boolean {
    return this.engine.promises.getPending().length > 0;
  }

  pendingPromises(): PendingPromise[] {
    return this.engine.promises.getPending();
  }

  resolvePromise(id: string, success: boolean): void {
    this.engine.promises.resume(id, success);
  }

  /** 0..1. Vacuously 1 when nothing has resolved. */
  keepRate(): number {
    return this.engine.promises.getKeepRate() / 100;
  }

  stats(): CoreModeStats {
    const total = this.engine.promises.size();
    const pending = this.engine.promises.getPending().length;
    const resolved = total - pending;
    const keepRate = this.engine.promises.getKeepRate() / 100;
    const kept = resolved > 0 ? Math.round(resolved * keepRate) : 0;
    const broken = resolved - kept;
    return { total, pending, kept, broken, keepRate };
  }

  clear(): void {
    this.engine.promises.clear();
  }
}
// === FILE END ===