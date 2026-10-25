// === FILE START ===
// packages/truth-score/src/fact-pill.ts
// PRD 5.6 · 8.7 · 8.8 · F-035 · F-036 · L3 · L10 · T-32.
//
// The Fact pill under every answer. Its job is to give one glanceable
// number + one glanceable chip that summarises the whole response's
// verification state, while NEVER inventing a number.
//
// Chip priority (PRD 5.6, exact order):
//   1. checkable === 0                         → pill hidden (nothing to show)
//   2. all checkable are RECALL_ONLY           → RECALL_ONLY (score hidden)
//   3. any critical claim is CONFLICTED        → CHECK
//   4. coverage < 0.5                          → PARTIAL
//   5. overall ≥ 85 AND no weak critical       → VERIFIED
//   6. overall ≥ 70                            → SUPPORTED
//   7. overall ≥ 50                            → MIXED
//   8. otherwise                               → WEAK
//
// L3: a score is never shown without coverage. `showScore` is true only
//     when coverage > 0 AND overall !== null.
//
// T-32 (applied to the pill): every field is derivable from the input
//     ClaimVerdict[]. No fabricated numbers. Verified by fact-pill.test.ts.

import type { ClaimVerdict } from './verdict.js';

export type FactChip =
  | 'CHECK'
  | 'PARTIAL'
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'RECALL_ONLY';

export type FactPillColor = 'accent' | 'ink' | 'warn' | 'bad' | 'grey';

export interface FactPillClaim {
  verdict: ClaimVerdict;
  /** PRD 8.2: 1.0 for central, 0.5 for supporting. */
  importance: number;
}

export interface FactPill {
  overall: number | null;
  checked: number;
  checkable: number;
  /** 0..1. checked / checkable. 1 when checkable === 0 (vacuous). */
  coverage: number;
  chip: FactChip;
  /** Sentence-case human label (PRD 2.8 microscopy). */
  label: string;
  color: FactPillColor;
  /** Single glyph for the narrow-width rendering. */
  glyph: string;
  /** False when nothing checkable exists (all NOT_SCORED / empty). */
  visible: boolean;
  /** False when coverage === 0 or overall is null (PRD L3). */
  showScore: boolean;
  /** PRD L10: always true until calibrated on 500 labels. */
  heuristic: true;
  /** Screen-reader label. */
  ariaLabel: string;
}

export const FACT_PILL_BANDS = {
  verified: 85,
  supported: 70,
  mixed: 50,
} as const;

// -----------------------------------------------------------------------------
// Chip mappings
// -----------------------------------------------------------------------------

function chipLabel(chip: FactChip): string {
  switch (chip) {
    case 'CHECK':
      return 'Check';
    case 'PARTIAL':
      return 'Partial';
    case 'VERIFIED':
      return 'Verified';
    case 'SUPPORTED':
      return 'Supported';
    case 'MIXED':
      return 'Mixed';
    case 'WEAK':
      return 'Weak';
    case 'RECALL_ONLY':
      return 'Recall-only';
  }
}

function chipColor(chip: FactChip): FactPillColor {
  // PRD 5.6: "bad" for CHECK; "grey outline" for PARTIAL; accent for VERIFIED;
  // ink for SUPPORTED; warn for MIXED/WEAK; grey for RECALL_ONLY.
  switch (chip) {
    case 'CHECK':
      return 'bad';
    case 'PARTIAL':
      return 'grey';
    case 'VERIFIED':
      return 'accent';
    case 'SUPPORTED':
      return 'ink';
    case 'MIXED':
      return 'warn';
    case 'WEAK':
      return 'warn';
    case 'RECALL_ONLY':
      return 'grey';
  }
}

function chipGlyph(chip: FactChip): string {
  switch (chip) {
    case 'CHECK':
      return '!';
    case 'PARTIAL':
      return '-';
    case 'VERIFIED':
      return '◆';
    case 'SUPPORTED':
      return '◇';
    case 'MIXED':
      return '△';
    case 'WEAK':
      return '△';
    case 'RECALL_ONLY':
      return '-';
  }
}

function buildAriaLabel(
  overall: number | null,
  checked: number,
  checkable: number,
  chip: FactChip,
  showScore: boolean,
): string {
  const word = chipLabel(chip).toLowerCase();
  if (!showScore || overall === null) {
    return `Fact: not scored, ${checked} of ${checkable} claims checked. ${word}.`;
  }
  return `Fact: ${overall} out of 100, ${checked} of ${checkable} claims checked. ${word}.`;
}

// -----------------------------------------------------------------------------
// The public assembly function
// -----------------------------------------------------------------------------

export function assembleFactPill(claims: FactPillClaim[]): FactPill {
  // 1. Partition
  const checkable = claims.filter((c) => c.verdict.status !== 'NOT_SCORED');
  const checked = checkable.filter((c) => c.verdict.status !== 'RECALL_ONLY');
  const scored = checked.filter((c) => c.verdict.score !== null);

  // 2. Coverage (vacuous-1 per Section 74 — but visible will be false)
  const coverage =
    checkable.length === 0 ? 1 : checked.length / checkable.length;

  // 3. Overall (weighted mean, capped by weakest critical + 15, PRD 8.7)
  let overall: number | null = null;
  if (scored.length > 0) {
    const totalW = scored.reduce((s, c) => s + c.importance, 0);
    const weightedSum = scored.reduce(
      (s, c) => s + c.importance * (c.verdict.score as number),
      0,
    );
    const mean = totalW > 0 ? weightedSum / totalW : 0;

    const criticalScores = scored
      .filter((c) => c.importance >= 0.7)
      .map((c) => c.verdict.score as number);
    const lowestCritical =
      criticalScores.length > 0 ? Math.min(...criticalScores) : Infinity;
    const weakestBound =
      lowestCritical === Infinity ? Infinity : lowestCritical + 15;

    overall = Math.round(Math.min(mean, weakestBound));
  }

  // 4. Critical signals
  const anyCriticalConflicted = scored.some(
    (c) => c.verdict.status === 'CONFLICTED' && c.importance >= 0.7,
  );

  // "Weak critical" = any critical claim that is NOT in a passing state.
  // PRD 5.6 says VERIFIED requires "no weak critical claim". The arithmetic
  // (weakestBound = lowestCritical + 15) already blocks overall ≥ 85 when a
  // critical claim scores < 70, but we also include UNVERIFIED / RECALL_ONLY
  // so a critical claim without a score can never be dressed up as VERIFIED.
  const anyWeakCritical = claims.some(
    (c) =>
      c.verdict.status !== 'NOT_SCORED' &&
      c.importance >= 0.7 &&
      (c.verdict.status === 'WEAK' ||
        c.verdict.status === 'MIXED' ||
        c.verdict.status === 'CONFLICTED' ||
        c.verdict.status === 'UNVERIFIED' ||
        c.verdict.status === 'RECALL_ONLY'),
  );

  // 5. Chip priority (PRD 5.6, exact order)
  let chip: FactChip;
  let visible: boolean;

  if (checkable.length === 0) {
    chip = 'RECALL_ONLY';
    visible = false;
  } else if (checked.length === 0) {
    chip = 'RECALL_ONLY';
    visible = true;
  } else if (anyCriticalConflicted) {
    chip = 'CHECK';
    visible = true;
  } else if (coverage < 0.5) {
    chip = 'PARTIAL';
    visible = true;
  } else if (
    overall !== null &&
    overall >= FACT_PILL_BANDS.verified &&
    !anyWeakCritical
  ) {
    chip = 'VERIFIED';
    visible = true;
  } else if (overall !== null && overall >= FACT_PILL_BANDS.supported) {
    chip = 'SUPPORTED';
    visible = true;
  } else if (overall !== null && overall >= FACT_PILL_BANDS.mixed) {
    chip = 'MIXED';
    visible = true;
  } else if (overall !== null) {
    chip = 'WEAK';
    visible = true;
  } else {
    // Should be unreachable — checked > 0 implies scored > 0 (all statuses
    // other than NOT_SCORED and RECALL_ONLY carry a numeric score).
    chip = 'RECALL_ONLY';
    visible = true;
  }

  // 6. L3: showScore only when there is real coverage
  const showScore = coverage > 0 && overall !== null;

  // 7. Derive display fields from the chip
  const label = chipLabel(chip);
  const color = chipColor(chip);
  const glyph = chipGlyph(chip);
  const ariaLabel = buildAriaLabel(
    overall,
    checked.length,
    checkable.length,
    chip,
    showScore,
  );

  return {
    overall,
    checked: checked.length,
    checkable: checkable.length,
    coverage,
    chip,
    label,
    color,
    glyph,
    visible,
    showScore,
    heuristic: true,
    ariaLabel,
  };
}
// === FILE END ===