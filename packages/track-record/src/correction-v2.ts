// === FILE START ===
// packages/track-record/src/correction-v2.ts
// PRD §8.8 · §8.11 · §10.7 · FR-TRUTH-21 · F-256.
//
// Corrections ledger. Every user-marked correction (wrong, thumbs-down, edit)
// becomes a labelled example. PRD §8.11 "Growth: Every user correction
// ('this is wrong', thumbs, edits) becomes a labelled example."
//
// Weekly summary answers: "I was wrong N times this week" (PRD §8.8).

import type { Label } from './calibration-v2.js';

export type CorrectionKind =
  | 'wrong'
  | 'right'
  | 'thumbs-down'
  | 'thumbs-up'
  | 'edit';

export interface Correction {
  id: string;
  claim_id: string;
  kind: CorrectionKind;
  /** Free-text note from the user, or null. */
  note: string | null;
  /** ISO 8601 timestamp. */
  at: string;
}

export function recordCorrection(
  list: Correction[],
  correction: Correction,
): Correction[] {
  return [...list, correction];
}

export function correctionOutcome(
  kind: CorrectionKind,
): 'correct' | 'incorrect' {
  switch (kind) {
    case 'right':
    case 'thumbs-up':
      return 'correct';
    case 'wrong':
    case 'thumbs-down':
    case 'edit':
      return 'incorrect';
  }
}

/**
 * Convert corrections to calibration labels. Only corrections whose claim has
 * a known score (via the caller-supplied map) are included; unknown-score
 * corrections are silently skipped — labels are meaningless without a score.
 */
export function correctionsToLabels(
  corrections: Correction[],
  claimScores: Readonly<Record<string, number>>,
): Label[] {
  const out: Label[] = [];
  for (const c of corrections) {
    const score = claimScores[c.claim_id];
    if (typeof score !== 'number' || !Number.isFinite(score)) continue;
    out.push({
      claim_id: c.claim_id,
      score,
      outcome: correctionOutcome(c.kind),
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Weekly summary (PRD §8.8)
// -----------------------------------------------------------------------------

export interface WeeklySummaryOptions {
  /** ISO 8601 timestamp; week window is [now − 7d, now]. */
  now: string;
  /** Minimum labels in window for the "N times" message. Default 20 (FR-TRUTH-21). */
  minLabelsForMessage?: number;
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  corrections_received: number;
  labelled_correct: number;
  labelled_incorrect: number;
  /** Miss rate for score ≥ 85 across ALL labels, or 0 if none. */
  miss_rate_85plus: number;
  /** PRD §8.8 message, or empty string when the window has < 20 signals. */
  message: string;
}

export function weeklySummary(
  allLabels: Label[],
  corrections: Correction[],
  opts: WeeklySummaryOptions,
): WeeklySummary {
  const nowMs = Date.parse(opts.now);
  const weekStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const inWindow = corrections.filter((c) => {
    const t = Date.parse(c.at);
    return t >= weekStartMs && t <= nowMs;
  });

  const correct = inWindow.filter(
    (c) => correctionOutcome(c.kind) === 'correct',
  ).length;
  const incorrect = inWindow.length - correct;

  const high = allLabels.filter((l) => l.score >= 85);
  const highWrong = high.filter((l) => l.outcome === 'incorrect').length;
  const missRate = high.length === 0 ? 0 : highWrong / high.length;

  const minLabels = opts.minLabelsForMessage ?? 20;
  let message = '';
  if (inWindow.length >= minLabels) {
    message =
      incorrect > 0
        ? `I was wrong ${incorrect} ${incorrect === 1 ? 'time' : 'times'} this week.`
        : 'Nothing was wrong this week.';
  }

  return {
    week_start: new Date(weekStartMs).toISOString(),
    week_end: new Date(nowMs).toISOString(),
    corrections_received: inWindow.length,
    labelled_correct: correct,
    labelled_incorrect: incorrect,
    miss_rate_85plus: missRate,
    message,
  };
}
// === FILE END ===