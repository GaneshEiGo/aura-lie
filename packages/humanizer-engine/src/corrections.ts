// packages/humanizer-engine/src/corrections.ts
// HR-10: "Corrections are visible. If Aura-lie changes its mind it says so."
// HR-09: "No fake imperfections: no deliberate typos, no pretend typing delays."

import type { Violation } from './types.js';

/** Presence of a visible correction marker. */
const CORRECTION_MARKERS: RegExp[] = [
  /\bmy\s+bad\b/i,
  /\bcorrected\s+(?:x\d+|one|twice|it)\b/i,
  /\bI\s+was\s+wrong\b/i,
  /\bto\s+fix\s+that\b/i,
  /\bactually,?\s+that'?s?\s+(?:not|incorrect|wrong)\b/i,
  /\bwait,?\s+(?:that'?s|that is)\s+(?:not|wrong)\b/i,
];

/** Patterns indicating fake imperfection. */
const FAKE_IMPERFECTION_PATTERNS: RegExp[] = [
  /\.\.\.+\s*(?:oops|whoops)/i,
  /\*typing\*/, // literal "typing" asterisks
  /\[typing\s*(?:\.\.\.|…)\]/i,
  /\bsorry\s+for\s+the\s+(?:delay|typo)\b/i,
  /\[pause\]/i,
];

export interface CorrectionResult {
  hasVisibleCorrection: boolean;
  hasFakeImperfection: boolean;
  violations: Violation[];
}

export function checkCorrections(text: string): CorrectionResult {
  const violations: Violation[] = [];
  if (!text) {
    return {
      hasVisibleCorrection: false,
      hasFakeImperfection: false,
      violations,
    };
  }

  const hasVisibleCorrection = CORRECTION_MARKERS.some((re) => re.test(text));
  const hasFakeImperfection = FAKE_IMPERFECTION_PATTERNS.some((re) =>
    re.test(text),
  );

  if (hasFakeImperfection) {
    violations.push({
      rule: 'HR-09',
      severity: 'error',
      message:
        'Fake imperfection detected — no pretend typos, delays, or "thinking" theatre',
    });
  }

  return { hasVisibleCorrection, hasFakeImperfection, violations };
}