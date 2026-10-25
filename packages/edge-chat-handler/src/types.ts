// packages/edge-chat-handler/src/types.ts
// PRD 7.2 step 1+2, T-22.

import type { TurnDeps } from '@aura-lie/orchestrator-core';

export interface AuthContext {
  userId: string;
  profileId?: string;
}

export interface ChatHandlerDeps extends TurnDeps {
  /**
   * PRD 7.2 step 2: "Edge checks the signed-in user."
   * Return null for unauthorized.
   */
  authenticate(req: Request): Promise<AuthContext | null> | AuthContext | null;

  /**
   * PRD 10.4: "Worker: kill-switch check FIRST."
   * When true, the handler emits a notice event and closes immediately.
   */
  isKillSwitchActive():
    | Promise<boolean>
    | boolean;

  /** Optional abort signal source override (tests). */
  clock?: { now(): number };
}

/** Parsed request body from PRD 7.2 step 1. */
export interface ChatRequestBody {
  turnId: string;
  text: string;
  mode?: 'instant' | 'think' | 'research' | 'council';
  persona?: string;
  sensitivity?: 'S0' | 'S1' | 'S2';
  riskTier?: 0 | 1 | 2 | 3;
  maxSubrequests?: number;
}

/** Body validation result. */
export type ValidateBodyResult =
  | { ok: true; value: ChatRequestBody }
  | { ok: false; code: string; message: string };