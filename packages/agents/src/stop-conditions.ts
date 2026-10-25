import type { Mission } from './types.js';

/**
 * PRD Section 10.9: Stop conditions.
 * All enforced in code to prevent runaway agents.
 */
export class StopConditions {
  public static shouldStop(mission: Mission, currentTime: number): { stop: boolean, reason?: string } {
    // 1. Iteration limit
    if (mission.cursor >= mission.maxSteps) {
      return { stop: true, reason: 'Iteration limit reached' };
    }

    // 2. Time limit
    if (mission.startedAt && (currentTime - mission.startedAt) > mission.timeoutMs) {
      return { stop: true, reason: 'Time limit exceeded' };
    }

    // 3. Goal achieved (no more steps)
    if (mission.cursor >= mission.steps.length) {
      return { stop: true, reason: 'Goal achieved' };
    }

    // 4. Permission required (check the next step)
    const nextStep = mission.steps[mission.cursor];
    if (nextStep && nextStep.requiresApproval) {
      return { stop: true, reason: 'Permission required' };
    }

    return { stop: false };
  }
}