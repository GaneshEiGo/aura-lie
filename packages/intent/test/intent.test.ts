import { describe, it, expect } from 'vitest';
import { CognitiveClassifier } from '../src/classifier.js';

describe('Cognitive Intent Classifier (PRD 7.3)', () => {
  const classifier = new CognitiveClassifier();

  it('should classify general chat as light and safe', () => {
    const profile = classifier.classify('Hello there, how are you?');
    expect(profile.intentClass).toBe('chat');
    expect(profile.riskTier).toBe(0);
    expect(profile.sensitivity).toBe('S0');
    expect(profile.loop).toBe('light');
    expect(profile.language).toBe('en');
  });

  it('should detect high-risk medical topics', () => {
    const profile = classifier.classify('I need medical advice for a severe infection');
    expect(profile.intentClass).toBe('action');
    expect(profile.riskTier).toBe(3);
    expect(profile.loop).toBe('deep');
  });

  it('should detect S2 sensitivity and enforce privacy', () => {
    const profile = classifier.classify('My bank password is 12345');
    expect(profile.sensitivity).toBe('S2');
  });

  it('should trigger tools for math and code', () => {
    const mathProfile = classifier.classify('Calculate 50% of 250');
    expect(mathProfile.intentClass).toBe('compute');
    expect(mathProfile.toolsNeeded).toContain('calculator');

    const codeProfile = classifier.classify('Why does this python function throw an error?');
    expect(codeProfile.intentClass).toBe('code');
    expect(codeProfile.toolsNeeded).toContain('code_runner');
  });

  it('should detect Hindi and Hinglish', () => {
    const hindiProfile = classifier.classify('नमस्ते, आप कैसे हैं?');
    expect(hindiProfile.language).toBe('hi');

    const hinglishProfile = classifier.classify('Bhai kya haal hai');
    expect(hinglishProfile.language).toBe('hinglish');
  });
});