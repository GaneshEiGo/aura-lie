// packages/humanizer-engine/src/persona-linter.ts
// HR-11: "Voice stays consistent per persona."

import type { Violation } from './types.js';

export interface PersonaAnchors {
  id: string;
  name: string;
  /** Banned phrases the persona must never use. */
  banned: string[];
  /** Extra rules from the persona YAML. */
  rules?: string[];
}

export interface PersonaLintResult {
  drift: boolean;
  bannedHits: string[];
  violations: Violation[];
}

/**
 * Deterministic drift check: any persona-banned phrase in the draft is a
 * drift signal. Runs on every 6 messages (per PRD 11.4) plus on every
 * persona switch.
 */
export function lintPersona(
  text: string,
  anchors: PersonaAnchors,
): PersonaLintResult {
  const bannedHits: string[] = [];
  const violations: Violation[] = [];
  if (!text) return { drift: false, bannedHits, violations };

  const lower = text.toLowerCase();
  for (const phrase of anchors.banned) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      bannedHits.push(phrase);
      violations.push({
        rule: 'HR-11',
        severity: 'warn',
        message: `Persona "${anchors.name}" banned phrase: "${phrase}"`,
        excerpt: phrase.slice(0, 80),
      });
    }
  }

  return { drift: bannedHits.length > 0, bannedHits, violations };
}