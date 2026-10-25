// packages/router-engine/src/router.ts
// PRD 7.4 hard filters + soft score. Output feeds runWaterfall() directly.

import type {
  Candidate,
  ModelInfo,
  RoutingOptions,
  RoutingResult,
  ScoredCandidate,
} from './types.js';
import { extractFeatures } from './features.js';
import { createDefaultRegistry } from './registry.js';
import { requiredCapabilities, latencyFitFor } from './roles.js';

const ESTIMATED_SYSTEM_TOKENS = 200;
const TPM_HEADROOM_PCT = 0.6; // PRD 7.4

function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

function breakerHealth(
  family: string,
  options: RoutingOptions,
): number {
  if (!options.breakers) return 1.0;
  const state = options.breakers.getState(family);
  if (state === 'closed') return 1.0;
  if (state === 'half-open') return 0.5;
  return 0; // open (should have been filtered)
}

export function route(
  text: string,
  role: Candidate['role'],
  options: RoutingOptions = {},
): RoutingResult {
  const features = extractFeatures(text);
  const registry = options.registry ?? createDefaultRegistry();
  const promptTokens =
    options.promptTokensEstimate ??
    estimateTokens(text) + ESTIMATED_SYSTEM_TOKENS;

  const models = registry.byRole(role);
  const scored: ScoredCandidate[] = [];

  for (const model of models) {
    const candidate: Candidate = {
      family: model.family,
      model: model.model,
      role,
    };

    const rejection = applyHardFilters(
      model,
      role,
      features,
      promptTokens,
      options,
    );
    if (rejection) {
      scored.push({
        candidate,
        capabilityFit: 0,
        headroom: 0,
        health: 0,
        latencyFit: 0,
        diversityBonus: 0,
        score: 0,
        rejected: rejection,
      });
      continue;
    }

    // Soft score (PRD 7.4)
    const capabilityFit = model.capability[role] ?? 0;
    const headroom = options.headroom ? options.headroom(model.family) : 1.0;
    const health = breakerHealth(model.family, options);
    const latencyFit = latencyFitFor(role, model.latencyClass);
    const diversityBonus =
      role === 'judge' &&
      options.generatorFamily !== undefined &&
      model.family !== options.generatorFamily
        ? 1.5
        : 1.0;

    const score =
      capabilityFit * headroom * health * latencyFit * diversityBonus;

    scored.push({
      candidate,
      capabilityFit,
      headroom,
      health,
      latencyFit,
      diversityBonus,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const candidates: Candidate[] = scored
    .filter((s) => !s.rejected)
    .map((s) => s.candidate);

  return { role, features, candidates, scored, promptTokens };
}

function applyHardFilters(
  model: ModelInfo,
  role: Candidate['role'],
  features: ReturnType<typeof extractFeatures>,
  promptTokens: number,
  options: RoutingOptions,
): { filter: string; reason: string } | null {
  // Hard filter #1: sensitivity lane (PRD 12.3)
  if (features.sensitivityHint === 'S2' && model.lane !== 'private') {
    return {
      filter: 'sensitivity-lane',
      reason: 'S2 claims require the private lane',
    };
  }
  if (
    features.sensitivityHint === 'S1' &&
    model.lane === 'training-risk' &&
    !options.allowTrainingRiskForS1
  ) {
    return {
      filter: 'sensitivity-lane',
      reason: 'S1 claims prefer the private lane (training-risk not allowed)',
    };
  }

  // Hard filter #2: context window
  if (promptTokens > model.contextWindow) {
    return {
      filter: 'context-window',
      reason: `prompt ${promptTokens} > context ${model.contextWindow}`,
    };
  }

  // Hard filter #2b: TPM 60% rule (PRD 7.4)
  if (promptTokens > model.tokensPerMinute * TPM_HEADROOM_PCT) {
    return {
      filter: 'tpm-headroom',
      reason: `prompt ${promptTokens} > 60% of ${model.tokensPerMinute} TPM`,
    };
  }

  // Hard filter #3: required capabilities
  for (const cap of requiredCapabilities(role, features)) {
    if (!model.capabilities[cap]) {
      return { filter: 'capability', reason: `missing ${cap}` };
    }
  }

  // Hard filter #4: breaker closed
  if (options.breakers && !options.breakers.canAttempt(model.family)) {
    return {
      filter: 'breaker',
      reason: `breaker ${options.breakers.getState(model.family)} for ${model.family}`,
    };
  }

  // Hard filter #5: quota headroom
  if (options.headroom) {
    const h = options.headroom(model.family);
    if (!(h > 0)) {
      return {
        filter: 'quota',
        reason: `no quota headroom for ${model.family}`,
      };
    }
  }

  return null;
}