// packages/humanizer-engine/src/banned-filler.ts
// HR-01: "No stock openers or filler." Deterministic lint, no model call.

import type { Violation } from './types.js';
import { BANNED_FILLER_STARTER } from './types.js';

/**
 * Returns every banned filler phrase found in `text` (case-insensitive).
 * Empty array = clean.
 */
export function findBannedFiller(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of BANNED_FILLER_STARTER) {
    if (lower.includes(phrase.toLowerCase())) {
      hits.push(phrase);
    }
  }
  return hits;
}

export function banFillerViolations(text: string): Violation[] {
  const hits = findBannedFiller(text);
  return hits.map<Violation>((phrase) => ({
    rule: 'HR-01',
    severity: 'error',
    message: `Banned filler opener: "${phrase}"`,
    excerpt: phrase.slice(0, 80),
  }));
}