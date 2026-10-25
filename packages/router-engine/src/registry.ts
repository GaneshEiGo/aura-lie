// packages/router-engine/src/registry.ts
// PRD 7.4 + FR-ROUTE-04: static capability table, `paid: true` rejected.

import type { ModelInfo, ModelRegistry, ModelRole } from './types.js';

/**
 * Default model seeds from PRD 4.1. Numbers are planning ceilings only —
 * runtime headers overwrite them (see @aura-lie/quota-ledger). Only paid
 * model here is `openrouter/gpt-4-turbo`, deliberately present so the
 * registry filter (and the cost-guard scan) can be tested against it.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  // --- Groq (private lane) --------------------------------------------
  {
    family: 'groq',
    model: 'llama-3.3-70b-versatile',
    lane: 'private',
    contextWindow: 128_000,
    tokensPerMinute: 8_000,
    capabilities: { reasoning: true, vision: false, json: true, tools: true },
    latencyClass: 'strong',
    capability: {
      chat_quality: 0.9,
      reasoner: 0.85,
      judge: 0.8,
      chat_fast: 0.7,
      long_context: 0.7,
    },
  },
  {
    family: 'groq',
    model: 'llama-3.1-8b-instant',
    lane: 'private',
    contextWindow: 128_000,
    tokensPerMinute: 20_000,
    capabilities: { reasoning: false, vision: false, json: true, tools: true },
    latencyClass: 'fast',
    capability: {
      chat_fast: 0.85,
      chat_quality: 0.7,
      utility: 0.9,
      judge: 0.5,
    },
  },

  // --- Gemini (training-risk) -----------------------------------------
  {
    family: 'gemini',
    model: 'gemini-2-flash',
    lane: 'training-risk',
    contextWindow: 1_000_000,
    tokensPerMinute: 4_000_000,
    capabilities: { reasoning: true, vision: true, json: true, tools: true },
    latencyClass: 'balanced',
    capability: {
      chat_quality: 0.9,
      reasoner: 0.9,
      vision: 0.9,
      chat_fast: 0.75,
      long_context: 0.95,
      judge: 0.85,
    },
  },
  {
    family: 'gemini',
    model: 'gemini-2-flash-lite',
    lane: 'training-risk',
    contextWindow: 1_000_000,
    tokensPerMinute: 4_000_000,
    capabilities: { reasoning: false, vision: true, json: true, tools: false },
    latencyClass: 'fast',
    capability: {
      chat_fast: 0.9,
      utility: 0.85,
      vision: 0.75,
    },
  },

  // --- Cerebras (private) ---------------------------------------------
  {
    family: 'cerebras',
    model: 'llama-3.1-8b',
    lane: 'private',
    contextWindow: 8_192,
    tokensPerMinute: 60_000,
    capabilities: { reasoning: false, vision: false, json: true, tools: false },
    latencyClass: 'fast',
    capability: {
      chat_fast: 0.9,
      reasoner: 0.6,
      utility: 0.9,
      judge: 0.55,
    },
  },

  // --- Workers AI (private) -------------------------------------------
  {
    family: 'workers-ai',
    model: '@cf/meta/llama-3.3-70b-instruct',
    lane: 'private',
    contextWindow: 128_000,
    tokensPerMinute: 10_000,
    capabilities: { reasoning: true, vision: false, json: true, tools: true },
    latencyClass: 'balanced',
    capability: {
      chat_quality: 0.85,
      reasoner: 0.8,
      judge: 0.8,
      utility: 0.7,
    },
  },

  // --- OpenRouter (PAID — must never be routed) -----------------------
  {
    family: 'openrouter',
    model: 'gpt-4-turbo',
    lane: 'training-risk',
    contextWindow: 128_000,
    tokensPerMinute: 30_000,
    capabilities: { reasoning: true, vision: true, json: true, tools: true },
    latencyClass: 'balanced',
    capability: {
      chat_quality: 0.95,
      reasoner: 0.95,
      judge: 0.9,
      vision: 0.9,
    },
    paid: true,
  },
];

/** Static registry — models filtered at construction so paid ones never leak. */
export class StaticModelRegistry implements ModelRegistry {
  private readonly models: ModelInfo[];

  constructor(models: ModelInfo[]) {
    this.models = models.filter((m) => !m.paid);
  }

  list(): ModelInfo[] {
    return this.models.map((m) => ({
      ...m,
      capability: { ...m.capability },
      capabilities: { ...m.capabilities },
    }));
  }

  byRole(role: ModelRole): ModelInfo[] {
    return this.list().filter((m) => (m.capability[role] ?? 0) > 0);
  }
}

let _default: ModelRegistry | null = null;

export function createDefaultRegistry(): ModelRegistry {
  if (!_default) _default = new StaticModelRegistry(DEFAULT_MODELS);
  return _default;
}

/** Reset the cached default (used only by tests). */
export function __resetDefaultRegistry(): void {
  _default = null;
}