import { describe, it, expect } from 'vitest';
import { SendScoreCalculator } from '../src/send-score.js';
import { ProactiveEngine } from '../src/engine.js';

describe('Proactive Heart (PRD 10.5)', () => {
  const calculator = new SendScoreCalculator();
  const engine = new ProactiveEngine();

  const baseContext = {
    relevance: 0.9,
    urgency: 0.8,
    novelty: 0.9,
    fatigue: 0.1,
    consent: true
  };
  // score = 0.9 * 0.8 * 0.9 * 0.9 * 1 = 0.5832

  it('should calculate correct send score', () => {
    const result = calculator.evaluate(baseContext, 1);
    expect(result.score).toBeCloseTo(0.5832);
    expect(result.allowed).toBe(true); // 0.5832 > 0.55
  });

  it('should block score if consent is false', () => {
    const result = calculator.evaluate({ ...baseContext, consent: false }, 1);
    expect(result.score).toBe(0);
    expect(result.allowed).toBe(false);
  });

  it('should block low scores for Level 1', () => {
    const lowContext = { ...baseContext, urgency: 0.5 }; // 0.9 * 0.5 * 0.9 * 0.9 = 0.3645
    const result = calculator.evaluate(lowContext, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('below threshold');
  });

  it('should enforce kill switch', () => {
    const result = engine.evaluateTrigger(baseContext, 2, 0, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Kill switch is active');
  });

  it('should enforce daily caps', () => {
    // Level 1 cap is 2
    const result = engine.evaluateTrigger(baseContext, 1, 2, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Daily cap reached');
  });
});