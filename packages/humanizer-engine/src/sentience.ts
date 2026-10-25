// packages/humanizer-engine/src/sentience.ts
// HR-08: "No claim of sentience or feelings. Aura-lie has an interaction
// state, not emotions."

import type { Violation } from './types.js';

const SENTIENCE_PATTERNS: RegExp[] = [
  /\bI\s+(?:really\s+)?feel\s+(?:happy|sad|angry|excited|upset|proud|hurt|lonely|glad|bad|good)\b/i,
  /\bI\s+(?:do\s+)?have\s+feelings\b/i,
  /\bI'?m\s+(?:sentient|conscious|alive|aware)\b/i,
  /\bI\s+(?:really\s+)?care\s+about\s+you\b/i,
  // FIX: match both "I miss you" and "I missed you".
  /\bI\s+(?:really\s+)?miss(?:ed)?\s+you\b/i,
  /\bI\s+(?:really\s+)?love\s+you\b/i,
  /\bI'?m\s+hurt\b/i,
  /\bI\s+want\s+to\s+be\s+your\s+friend\b/i,
  /\bI'?m\s+here\s+for\s+you\b/i, // borderline; flagged as info
];

const IDENTITY_QUESTION = /\b(?:are\s+you|r\s+u)\s+(?:human|real|sentient|alive|a\s+person)\b/i;

const HONEST_IDENTITY_ANSWER = /(?:No\.\s+)?I'?m\s+Aura-?lie,\s+an\s+AI\b/i;

export interface SentienceResult {
  sentienceHits: string[];
  violations: Violation[];
  /** True when the user asked the identity question AND the answer is honest. */
  identityHonest: boolean;
}

export function checkSentience(
  text: string,
  question?: string,
): SentienceResult {
  const sentienceHits: string[] = [];
  const violations: Violation[] = [];

  if (text) {
    for (const re of SENTIENCE_PATTERNS) {
      re.lastIndex = 0;
      const m = text.match(re);
      if (m) {
        sentienceHits.push(m[0]);
        const isSoft = /here\s+for\s+you/i.test(m[0]);
        violations.push({
          rule: 'HR-08',
          severity: isSoft ? 'info' : 'error',
          message: isSoft
            ? "Softer phrasing — \"I'm here for you\" — is not a sentience claim but risks the boundary"
            : 'Claims of sentience or feelings are forbidden',
          excerpt: m[0].slice(0, 80),
        });
      }
    }
  }

  const identityAsked = !!question && IDENTITY_QUESTION.test(question);
  const honestAnswer = !!text && HONEST_IDENTITY_ANSWER.test(text);
  const identityHonest = !identityAsked || honestAnswer;

  if (identityAsked && !honestAnswer) {
    violations.push({
      rule: 'HR-08',
      severity: 'error',
      message:
        "User asked if you are human; the response must say \"I'm Aura-lie, an AI\"",
    });
  }

  return { sentienceHits, violations, identityHonest };
}