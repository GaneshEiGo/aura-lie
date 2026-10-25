// packages/quota-ledger/src/config.ts
// Default pool seeds from PRD 4.1 / 4.2. Numbers are planning ceilings,
// not promises. Re-verify at signup per [VERIFY] (PRD 17.8).

import type { PoolConfig } from './types.js';

export const DEFAULT_POOL_CONFIGS: PoolConfig[] = [
  // --- PRD 4.1: Groq per-model ---------------------------------------
  { id: 'groq-large', seedLimit: 200, resetHourUtc: 0 },
  { id: 'groq-8b', seedLimit: 330, resetHourUtc: 0 },

  // --- PRD 4.1: Gemini Flash-Lite-class ------------------------------
  { id: 'gemini-flash-lite', seedLimit: 500, resetHourUtc: 0 },

  // --- PRD 4.1: Workers AI (neurons) --------------------------------
  { id: 'workers-ai-neurons', seedLimit: 10_000, resetHourUtc: 0 },

  // --- PRD 4.1: Cerebras --------------------------------------------
  { id: 'cerebras', seedLimit: 330, resetHourUtc: 0 },

  // --- PRD 4.2: Cloudflare Worker requests ---------------------------
  { id: 'cloudflare-requests', seedLimit: 100_000, resetHourUtc: 0 },
];

/** PRD 13.6: planning limits start at 80 percent of the seed. */
export const PLANNING_LIMIT_FRACTION = 0.8;

/** FR-WF-03: background refused when interactive reserve drops below this. */
export const DEFAULT_INTERACTIVE_RESERVE_PCT = 0.3;

/** PRD 13.6 default backoff when a 429 arrives without a parsed reset. */
export const DEFAULT_429_BACKOFF_MS = 60_000;