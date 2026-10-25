import { BANNED_PHRASES } from './rules.js';

/**
 * PRD Section 11.5: Humanness rules.
 * Cleans the model's output to remove filler, enforce length bounds, and apply persona style.
 */
export class Humanizer {
  public humanize(response: string, persona?: any): { text: string, violations: string[] } {
    let text = response.trim();
    const violations: string[] = [];

    // 1. Remove banned phrases (Law L4: No filler)
    for (const phrase of BANNED_PHRASES) {
      const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedPhrase, 'gi');
      
      if (text.match(regex)) {
        violations.push(`Banned phrase detected: ${phrase}`);
        text = text.replace(regex, '');
      }
    }

    // 2. Clean up extra spaces left by removals
    text = text.replace(/\s+/g, ' ').trim();

    // 3. Enforce emoji limits based on persona sliders (PRD 11.5, HR-14)
    if (persona && persona.voice && persona.voice.sliders && persona.voice.sliders.emoji < 0.2) {
      const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu;
      if (emojiRegex.test(text)) {
        violations.push('Emoji violation: removed due to low persona slider');
        text = text.replace(emojiRegex, '').trim();
      }
    }

    // 4. Ensure first letter is capitalized after stripping
    if (text.length > 0) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    return { text, violations };
  }

  public checkLength(question: string, answer: string): boolean {
    if (question.length < 20 && answer.length > 500) return false;
    return true;
  }
}