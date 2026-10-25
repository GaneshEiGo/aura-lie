import type { TriggerContext, ProactiveDecision } from './types.js';
import { SendScoreCalculator } from './send-score.js';

/**
 * PRD Section 10.4 & 10.5: Heartbeat and Caps
 * Enforces hard caps (L1: 2, L2: 4, L3: 6) and the kill switch.
 */
export class ProactiveEngine {
  private calculator = new SendScoreCalculator();
  private readonly CAPS = { 1: 2, 2: 4, 3: 6 };

  public evaluateTrigger(
    context: TriggerContext, 
    autonomyLevel: number, 
    notesSentToday: number, 
    killSwitchActive: boolean
  ): ProactiveDecision {
    
    // 1. Kill Switch
    if (killSwitchActive) {
      return { allowed: false, reason: 'Kill switch is active', score: 0 };
    }

    // 2. Hard Cap Check
    const cap = this.CAPS[autonomyLevel as keyof typeof this.CAPS] || 0;
    if (autonomyLevel >= 1 && notesSentToday >= cap) {
      return { allowed: false, reason: 'Daily cap reached', score: 0 };
    }

    // 3. Score Calculation
    return this.calculator.evaluate(context, autonomyLevel);
  }
}