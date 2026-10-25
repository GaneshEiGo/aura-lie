// packages/humanizer-engine/src/uncertainty.ts
// HR-05: "State uncertainty plainly, once. No stacks of hedges."

import type { Violation } from './types.js';

const HEDGE_PATTERNS: RegExp[] = [
  /\bI\s+(?:think|believe|feel)\b/gi,
  /\bmaybe\b/gi,
  /\bperhaps\b/gi,
  /\bpossibly\b/gi,
  /\bprobably\b/gi,
  /\bit\s+(?:seems|appears)\b/gi,
  /\bmight\s+be\b/gi,
  /\bcould\s+be\b/gi,
  /\bmay\s+be\b/gi,
];

const UNCERTAINTY_MARKERS: RegExp[] = [
  /\bI\s+(?:don'?t|do not)\s+know\b/i,
  /\bI'?m\s+not\s+(?:sure|certain)\b/i,
  /\bunclear\b/i,
  /\buncertain\b/i,
  /\bI\s+couldn'?t\s+(?:find|verify)\b/i,
];

export interface UncertaintyResult {
  hedgeCount: number;
  hasUncertaintyMarker: boolean;
  violations: Violation[];
}

export function checkUncertainty(text: string): UncertaintyResult {
  if (!text) {
    return { hedgeCount: 0, hasUncertaintyMarker: false, violations: [] };
  }

  let hedgeCount = 0;
  for (const pattern of HEDGE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) hedgeCount += matches.length;
  }

  const hasUncertaintyMarker = UNCERTAINTY_MARKERS.some((re) => re.test(text));

  const violations: Violation[] = [];
  // "Stacks of hedges" — more than 2 hedge words anywhere in the message.
  if (hedgeCount > 2) {
    violations.push({
      rule: 'HR-05',
      severity: 'warn',
      message: `Stacks of hedges (${hedgeCount} hedge words); say it once, plainly`,
    });
  }
  // Asking for uncertainty markers when the message has no clear answer
  // is caught at a higher level; here we only enforce the count rule.

  return { hedgeCount, hasUncertaintyMarker, violations };
}