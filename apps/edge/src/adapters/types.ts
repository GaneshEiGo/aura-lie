// apps/edge/src/adapters/types.ts
// The minimal surface every real adapter needs.

import type { FetchLike } from '@aura-lie/cost-guard';

export interface CommonAdapterOptions {
  apiKey: string;
  /** Injected for tests (bypasses the global fetch). */
  fetchImpl?: FetchLike;
  /** Override the model list — defaults to the well-known models. */
  defaultModel?: string;
}