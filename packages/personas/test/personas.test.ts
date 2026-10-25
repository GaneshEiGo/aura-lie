import { describe, it, expect } from 'vitest';
import { PERSONA_ROSTER } from '../src/data.js';
import { PersonaLinter } from '../src/linter.js';
import { PersonaPromptBuilder } from '../src/prompt-builder.js';

describe('Persona Engine (PRD 11)', () => {
  const linter = new PersonaLinter();
  const builder = new PersonaPromptBuilder();

  it('should have Aura-lie, Yuki, and Kira in the W2 roster', () => {
    expect(PERSONA_ROSTER['aura-lie']).toBeDefined();
    expect(PERSONA_ROSTER['yuki']).toBeDefined();
    expect(PERSONA_ROSTER['kira']).toBeDefined();
  });

  it('should build a prompt block enforcing style-only changes', () => {
    const prompt = builder.build(PERSONA_ROSTER['yuki']);
    expect(prompt).toContain('Voice: Cool analyst (kuudere).');
    expect(prompt).toContain('warmth 0.25');
    expect(prompt).toContain('Never use: Certainly!, I\'d be happy to, Great question');
    expect(prompt).toContain('You change style only. Truth rules, safety rules and permissions are unchanged.');
  });

  it('should catch banned phrases', () => {
    const response = "Certainly! I can help with that.";
    const result = linter.lint(response, PERSONA_ROSTER['aura-lie']);
    
    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Banned phrase detected: "Certainly!"');
  });

  it('should catch emoji violations based on slider', () => {
    const response = "Here is the data 📊";
    const result = linter.lint(response, PERSONA_ROSTER['yuki']); // Yuki's emoji slider is 0.05
    
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('Emoji violation');
  });

  it('should pass clean text for the persona', () => {
    const response = "The result is 42. Working shown.";
    const result = linter.lint(response, PERSONA_ROSTER['yuki']);
    
    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});