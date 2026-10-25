import { describe, it, expect } from 'vitest';
import { Humanizer } from '../src/humanizer.js';

describe('Humanizer (PRD 11.5)', () => {
  const humanizer = new Humanizer();

  it('should remove banned filler phrases', () => {
    const raw = "Certainly! Here is the answer. Great question! The data shows 41%.";
    const result = humanizer.humanize(raw);
    
    expect(result.text).toBe("Here is the answer. The data shows 41%.");
    expect(result.violations.length).toBe(2);
    expect(result.violations[0]).toContain('Certainly!');
  });

  it('should strip emojis if persona slider is low', () => {
    const raw = "The result is 42 📊🚀";
    const persona = { voice: { sliders: { emoji: 0.05 } } };
    const result = humanizer.humanize(raw, persona);
    
    expect(result.text).toBe("The result is 42");
    expect(result.violations).toContain('Emoji violation: removed due to low persona slider');
  });

  it('should keep emojis if persona slider is high', () => {
    const raw = "The result is 42 📊🚀";
    const persona = { voice: { sliders: { emoji: 0.8 } } };
    const result = humanizer.humanize(raw, persona);
    
    expect(result.text).toBe("The result is 42 📊🚀");
    expect(result.violations.length).toBe(0);
  });

  it('should enforce length bounds for short questions', () => {
    const shortQ = "What is 2+2?";
    const longA = "A".repeat(600);
    expect(humanizer.checkLength(shortQ, longA)).toBe(false);
    
    const goodA = "The answer is 4.";
    expect(humanizer.checkLength(shortQ, goodA)).toBe(true);
  });
});