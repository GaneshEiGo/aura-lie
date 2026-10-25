import type { PersonaSchema } from './types.js';

/**
 * PRD Section 11.4: Persona linter (FR-PERS-05)
 * Every 6 messages and on every switch, a small check compares recent replies with the persona's anchors and banned phrases.
 */
export class PersonaLinter {
  public lint(responseText: string, persona: PersonaSchema): { passed: boolean, violations: string[] } {
    const violations: string[] = [];
    const lowerText = responseText.toLowerCase();

    // 1. Check Banned Phrases
    for (const phrase of persona.banned) {
      if (lowerText.includes(phrase.toLowerCase())) {
        violations.push(`Banned phrase detected: "${phrase}"`);
      }
    }

    // 2. Basic Emoji heuristic based on slider (simplistic for W2)
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu;
    const emojiCount = (responseText.match(emojiRegex) || []).length;
    
    // If slider is very low (e.g., < 0.2), enforce 0 emojis
    if (persona.voice.sliders.emoji < 0.2 && emojiCount > 0) {
      violations.push(`Emoji violation: Slider is ${persona.voice.sliders.emoji}, but found ${emojiCount} emojis.`);
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }
}