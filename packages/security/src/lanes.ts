// === FILE START ===
// packages/security/src/lanes.ts
// PRD 12.3 · F-226 · FR-WF-06 · FR-MEM-08.
//
// Lane enforcement. Two lanes:
//   - private          : providers whose terms say prompts are not used for training
//   - training-risk    : providers whose terms allow training on prompts
//
// Rules per PRD 12.3:
//   S0 → any lane
//   S1 → private preferred; training-risk only if user opts in
//   S2 → private only; training-risk only with explicit per-message confirmation
//
// FR-MEM-08: S2 memories never leave the device. Enforced in
// filterMemoriesForProvider (S2 excluded for ALL providers).

import type { Sensitivity, ClassificationOptions } from './sensitivity.js';
import { classify } from './sensitivity.js';

export type Lane = 'private' | 'training-risk';

export interface ProviderInfo {
  id: string;
  lane: Lane;
}

export interface LanePreferences {
  /** User opts in to allow S1 to training-risk when private is unavailable. */
  allowTrainingRiskForS1: boolean;
}

export interface LaneOverride {
  /** Per-message explicit confirmation for S2 → training-risk. */
  allowTrainingRiskForS2?: boolean;
}

export interface CanSendResult {
  allowed: boolean;
  class: Sensitivity;
  providerLane: Lane;
  reason: string;
}

export function canSend(
  prompt: string,
  provider: ProviderInfo,
  preferences: LanePreferences,
  override?: LaneOverride,
  classificationOptions?: ClassificationOptions,
): CanSendResult {
  const c = classify(prompt, classificationOptions);

  if (c === 'S0') {
    return {
      allowed: true,
      class: 'S0',
      providerLane: provider.lane,
      reason: 'S0 may go to any lane',
    };
  }

  if (c === 'S1') {
    if (provider.lane === 'private') {
      return {
        allowed: true,
        class: 'S1',
        providerLane: 'private',
        reason: 'S1 to private lane',
      };
    }
    if (preferences.allowTrainingRiskForS1) {
      return {
        allowed: true,
        class: 'S1',
        providerLane: 'training-risk',
        reason: 'S1 to training-risk (user opted in)',
      };
    }
    return {
      allowed: false,
      class: 'S1',
      providerLane: 'training-risk',
      reason: 'S1 requires private lane or explicit user opt-in',
    };
  }

  // S2
  if (provider.lane === 'private') {
    return {
      allowed: true,
      class: 'S2',
      providerLane: 'private',
      reason: 'S2 to private lane',
    };
  }
  if (override?.allowTrainingRiskForS2) {
    return {
      allowed: true,
      class: 'S2',
      providerLane: 'training-risk',
      reason: 'S2 to training-risk (explicit per-message confirmation)',
    };
  }
  return {
    allowed: false,
    class: 'S2',
    providerLane: 'training-risk',
    reason: 'S2 requires private lane or explicit per-message confirmation',
  };
}

/** Return all providers that may receive this prompt under the given rules. */
export function selectProviders(
  prompt: string,
  providers: ProviderInfo[],
  preferences: LanePreferences,
  override?: LaneOverride,
  classificationOptions?: ClassificationOptions,
): ProviderInfo[] {
  return providers.filter((p) =>
    canSend(prompt, p, preferences, override, classificationOptions).allowed,
  );
}

// -----------------------------------------------------------------------------
// FR-MEM-08 — S2 memories never leave the device
// -----------------------------------------------------------------------------

export interface MemoryLike {
  sensitivity: Sensitivity;
}

/**
 * Filter a memory list down to what may be included in a prompt for a
 * given provider. FR-MEM-08 is stricter than the prompt-level rules:
 * S2 memories are excluded for ALL providers (they never leave the device),
 * not just training-risk.
 */
export function filterMemoriesForProvider<M extends MemoryLike>(
  memories: M[],
  _provider: ProviderInfo,
): M[] {
  return memories.filter((m) => m.sensitivity !== 'S2');
}

/** Convenience: true if any memory in the list is S2. */
export function hasPrivateMemories<M extends MemoryLike>(memories: M[]): boolean {
  return memories.some((m) => m.sensitivity === 'S2');
}
// === FILE END ===