import type { TriggerContext, ProactiveDecision } from './types.js';

/**
 * PRD Section 10.5: Triggers and the send score
 * Formula: R x U x N x (1 - Fa) x K
 */
export class SendScoreCalculator {
  public evaluate(context: TriggerContext, autonomyLevel: number): ProactiveDecision {
    const { relevance, urgency, novelty, fatigue, consent } = context;
    const K = consent ? 1 : 0;
    
    // Calculate raw score
    const score = Math.max(0, Math.min(1, relevance * urgency * novelty * (1 - fatigue) * K));

    // Determine threshold based on Level
    let threshold = 1.0; // Unreachable by default
    if (autonomyLevel === 1) threshold = 0.55;
    else if (autonomyLevel === 2) threshold = 0.45;
    else if (autonomyLevel === 3) threshold = 0.40;

    if (autonomyLevel < 1) {
      return { allowed: false, reason: 'Autonomy level 0 (Silent)', score };
    }

    if (score >= threshold) {
      return { allowed: true, reason: 'Score passed threshold', score };
    }

    return { allowed: false, reason: `Score ${score.toFixed(2)} below threshold ${threshold}`, score };
  }
}