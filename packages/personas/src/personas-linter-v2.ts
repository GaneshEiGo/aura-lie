// === FILE START ===
// packages/personas/src/personas-linter-v2.ts
// PRD §11.4 · §11.5 · FR-PERS-05 · T-09.
//
// Deterministic drift check. No model call by default. Takes a persona and a
// slice of recent replies, returns:
//
//   · banned_hits  — replies that contain any banned phrase
//   · drift_score  — 0..1 where 1 = fully aligned with the persona
//   · drift_notes  — short human-readable notes
//
// T-09 gate: over a 20-turn transcript, banned_hits must be 0 AND drift_score
// must be ≥ 0.85 per persona.
//
// FIX HISTORY (post Section 94):
//   The original formula penalised ANY length deviation linearly. That made
//   CONCISE replies look like drift. PRD §11.4 says drift is a VOICE change
//   (banned phrases, tone), not an exact word-count change. Corrected to a
//   ±50% tolerance band: within the band lengthFit = 1, beyond it the
//   penalty scales linearly to 0 at 100% deviation.

import type { Persona } from './personas-roster-v2.js';

export interface LintInput {
  persona: Persona;
  replies: string[];
}

export interface LintResult {
  banned_hits: string[];
  drift_score: number;
  drift_notes: string[];
}

export const DRIFT_THRESHOLD = 0.85;

/** Fraction of expected length that is treated as "on target". */
export const LENGTH_TOLERANCE_BAND = 0.5;

export function lintPersona(input: LintInput): LintResult {
  const banned = findBannedHits(input.replies, input.persona.banned);
  const drift = scoreDrift(input);

  const notes: string[] = [];
  if (banned.length > 0) {
    notes.push(`Banned phrases found: ${banned.length}`);
  }
  if (drift < DRIFT_THRESHOLD) {
    notes.push(
      `Drift below threshold: ${drift.toFixed(2)} < ${DRIFT_THRESHOLD}`,
    );
  }

  return {
    banned_hits: banned,
    drift_score: drift,
    drift_notes: notes,
  };
}

export function findBannedHits(
  replies: string[],
  banned: string[],
): string[] {
  if (banned.length === 0) return [];
  const hits: string[] = [];
  for (const reply of replies) {
    for (const phrase of banned) {
      if (phrase.length === 0) continue;
      const re = new RegExp(escapeRegex(phrase), 'i');
      if (re.test(reply)) {
        hits.push(phrase);
      }
    }
  }
  return Array.from(new Set(hits));
}

/**
 * Deterministic drift proxy. Not a model.
 *
 *   expected_length   = 6 + verbosity * 40           // word count target
 *   tolerance         = 0.5 * expected_length        // ±50% band
 *   length_deviation  = |mean_words − expected| / expected
 *   length_fit        = 1 if deviation ≤ tolerance
 *                     = 1 − (deviation − tolerance) / tolerance   otherwise
 *   formality_fit     = 1 − lowercase_fraction * (1 − formality)
 *   drift_score       = 0.6 * length_fit + 0.4 * formality_fit
 *
 * Clamped to [0, 1].
 */
export function scoreDrift(input: LintInput): number {
  const { persona, replies } = input;
  if (replies.length === 0) return 1;

  const wordCounts = replies.map(
    (r) => r.split(/\s+/).filter(Boolean).length,
  );
  const meanWords =
    wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  const expected = 6 + persona.sliders.verbosity * 40;

  const tolerance = LENGTH_TOLERANCE_BAND;
  const deviation = Math.abs(meanWords - expected) / Math.max(expected, 1);
  const lengthFit =
    deviation <= tolerance
      ? 1
      : clamp01(1 - (deviation - tolerance) / tolerance);

  const lowercaseOpeners = replies.filter((r) =>
    /^[a-z]/.test(r.trim()),
  ).length;
  const lowercaseFraction = lowercaseOpeners / replies.length;
  const formalityFit =
    1 - lowercaseFraction * (1 - persona.sliders.formality);

  return clamp01(0.6 * lengthFit + 0.4 * formalityFit);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// === FILE END ===