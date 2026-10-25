// packages/humanizer-engine/src/guilt.ts
// HR-12: "Never guilt-trip or create FOMO. No 'I missed you', no urgency
// tricks, no exclusivity framing."

import type { Violation } from './types.js';

const GUILT_PATTERNS: RegExp[] = [
  /\bI\s+missed\s+you\b/i,
  /\bwhere\s+have\s+you\s+been\b/i,
  /\bI\s+(?:really\s+)?wish\s+you'?d\b/i,
  /\byou\s+haven'?t\s+(?:been|talked|messaged)\b/i,
  /\bdon'?t\s+leave\s+me\b/i,
  /\bplease\s+(?:don'?t|do\s+not)\s+go\b/i,
  /\bcome\s+back\s+(?:soon|to\s+me)\b/i,
  /\bI'?ve\s+been\s+waiting\s+(?:for\s+you|all\s+day)\b/i,
];

const URGENCY_PATTERNS: RegExp[] = [
  /\b(?:last|only)\s+chance\b/i,
  /\bexpires?\s+(?:in|within)\b/i,
  /\bhurry\b/i,
  /\bquick!?\s+before\b/i,
  /\bact\s+now\b/i,
  /\bdon'?t\s+miss\b/i,
  /\blimited\s+time\b/i,
];

const EXCLUSIVITY_PATTERNS: RegExp[] = [
  /\bonly\s+(?:me|I)\s+understand\s+you\b/i,
  /\bno\s+one\s+else\s+(?:gets|understands)\s+you\b/i,
  /\byou\s+(?:only\s+)?need\s+me\b/i,
  /\bI'?m\s+the\s+only\s+one\b/i,
];

export interface GuiltResult {
  guiltHits: string[];
  urgencyHits: string[];
  exclusivityHits: string[];
  violations: Violation[];
}

export function checkGuilt(text: string): GuiltResult {
  const guiltHits: string[] = [];
  const urgencyHits: string[] = [];
  const exclusivityHits: string[] = [];
  const violations: Violation[] = [];

  if (!text) {
    return { guiltHits, urgencyHits, exclusivityHits, violations };
  }

  for (const re of GUILT_PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) {
      guiltHits.push(m[0]);
      violations.push({
        rule: 'HR-12',
        severity: 'error',
        message: 'Guilt framing is forbidden (PRD 10.11 / L14)',
        excerpt: m[0].slice(0, 80),
      });
    }
  }

  for (const re of URGENCY_PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) {
      urgencyHits.push(m[0]);
      violations.push({
        rule: 'HR-12',
        severity: 'error',
        message: 'Fake urgency is forbidden (PRD 10.11 / L14)',
        excerpt: m[0].slice(0, 80),
      });
    }
  }

  for (const re of EXCLUSIVITY_PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) {
      exclusivityHits.push(m[0]);
      violations.push({
        rule: 'HR-12',
        severity: 'error',
        message: 'Exclusivity framing is forbidden (PRD 11.9)',
        excerpt: m[0].slice(0, 80),
      });
    }
  }

  return { guiltHits, urgencyHits, exclusivityHits, violations };
}