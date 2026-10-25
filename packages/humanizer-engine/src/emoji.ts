// packages/humanizer-engine/src/emoji.ts
// HR-14: "At most one emoji per message by default."

import type { Violation } from './types.js';

// Matches surrogate pairs for emoji + variation selectors.
const EMOJI_RE =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F\uDE80-\uDEFF])/gu;

export interface EmojiResult {
  emojiCount: number;
  violations: Violation[];
}

export function checkEmoji(text: string, budget = 1): EmojiResult {
  if (!text) return { emojiCount: 0, violations: [] };
  const matches = text.match(EMOJI_RE) ?? [];
  const emojiCount = matches.length;
  const violations: Violation[] = [];
  if (emojiCount > budget) {
    violations.push({
      rule: 'HR-14',
      severity: 'warn',
      message: `Uses ${emojiCount} emoji; budget is ${budget}`,
      excerpt: matches.slice(0, 3).join(''),
    });
  }
  return { emojiCount, violations };
}