// apps/edge/src/deps.ts
// Assemble the ChatHandlerDeps from all 14 packages.

import type {
  ChatHandlerDeps,
  AuthContext,
} from '@aura-lie/edge-chat-handler';
import type {
  ProviderAdapter,
  ModelFamily,
} from '@aura-lie/stream-proxy';
import type {
  BreakerLike,
  ModelRegistry,
  VerifyFn,
} from '@aura-lie/orchestrator-core';
import type { LedgerLike } from '@aura-lie/orchestrator-core';
import type { CurateFn } from '@aura-lie/orchestrator-core';

export interface CreateChatHandlerDepsOptions {
  adapters: Partial<Record<ModelFamily, ProviderAdapter>>;
  authenticate: (
    req: Request,
  ) => Promise<AuthContext | null> | AuthContext | null;
  isKillSwitchActive: () => Promise<boolean> | boolean;
  clock?: { now(): number };
  // Optional wiring (each layer can be added incrementally)
  ledger?: LedgerLike;
  breakers?: BreakerLike;
  registry?: ModelRegistry;
  headroom?: (family: ModelFamily) => number;
  verify?: VerifyFn;
  curate?: CurateFn;
}

export function createChatHandlerDeps(
  options: CreateChatHandlerDepsOptions,
): ChatHandlerDeps {
  return {
    adapters: options.adapters,
    authenticate: options.authenticate,
    isKillSwitchActive: options.isKillSwitchActive,
    clock: options.clock,
    ledger: options.ledger,
    breakers: options.breakers,
    registry: options.registry,
    headroom: options.headroom,
    verify: options.verify,
    curate: options.curate,
  };
}