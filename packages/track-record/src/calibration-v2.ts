// === FILE START ===
// packages/track-record/src/calibration-v2.ts
// PRD §8.8 · §8.11 · §15.2 T-07 · FR-TRUTH-21 · F-256.
//
// The calibration bench:
//   · reliabilityBins(labels)    — per-decile mean score vs mean outcome
//   · computeECE(labels)         — Expected Calibration Error (0..1)
//   · isotonicRegression(labels) — PAVA fit, monotone non-decreasing
//   · computeCalibrationState    — heuristic → calibrated at minLabels + 1
//                                   labels with holdout ECE ≤ 0.10
//   · computeMissRate(labels)    — fraction of score ≥ 85 that were wrong
//   · shouldRaiseThresholds      — true when miss rate on high scores > 5%
//
// PRD §8.11 "Switch: replace 'heuristic' with 'calibrated on N claims' only
// when the target is met on a held-out set."
//
// BOUNDARY SEMANTICS (T-07.4 contract):
//   The guard uses `<=`. A run with exactly `minLabels` labels STAYS heuristic.
//   You need at least minLabels + 1 labels to qualify. This is the safety-first
//   interpretation of PRD L10 ("Heuristic until calibrated") — one extra
//   independent label beyond the minimum absorbs a single mislabelled seed
//   without flipping the display label.
//
// All functions are pure. Deterministic splits by FNV-1a hash of claim_id.

export interface Label {
  claim_id: string;
  /** 0..100 Fact Score. */
  score: number;
  outcome: 'correct' | 'incorrect';
}

export interface ReliabilityBin {
  bin_lower: number;    // inclusive
  bin_upper: number;    // exclusive (except the last bin, which is closed)
  count: number;
  mean_score: number;   // 0..100
  mean_outcome: number; // 0..1
}

/**
 * Decile bins: [0,10), [10,20), ..., [90,100].
 * The last bin is closed at 100.
 */
export function reliabilityBins(
  labels: Label[],
  numBins = 10,
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  const step = 100 / numBins;
  for (let i = 0; i < numBins; i++) {
    const lower = i * step;
    const upper = (i + 1) * step;
    const inBin = labels.filter((l) => {
      if (i === numBins - 1) return l.score >= lower && l.score <= 100;
      return l.score >= lower && l.score < upper;
    });
    const count = inBin.length;
    const meanScore =
      count > 0
        ? inBin.reduce((a, l) => a + l.score, 0) / count
        : 0;
    const meanOutcome =
      count > 0
        ? inBin.reduce(
            (a, l) => a + (l.outcome === 'correct' ? 1 : 0),
            0,
          ) / count
        : 0;
    bins.push({
      bin_lower: lower,
      bin_upper: upper,
      count,
      mean_score: meanScore,
      mean_outcome: meanOutcome,
    });
  }
  return bins;
}

/**
 * Expected Calibration Error.
 * ECE = sum over bins of (|bin| / N) * |mean_score/100 − mean_outcome|
 */
export function computeECE(labels: Label[], numBins = 10): number {
  if (labels.length === 0) return 0;
  const bins = reliabilityBins(labels, numBins);
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const weight = b.count / labels.length;
    const gap = Math.abs(b.mean_score / 100 - b.mean_outcome);
    ece += weight * gap;
  }
  return ece;
}

// -----------------------------------------------------------------------------
// Isotonic regression (PAVA)
// -----------------------------------------------------------------------------

export interface IsotonicKnot {
  score_lower: number;
  score_upper: number;
  calibrated_prob: number; // 0..1
  weight: number;          // number of labels in this knot
}

/**
 * Isotonic regression of outcome on score. Fits a monotone non-decreasing
 * step function via the Pool Adjacent Violators Algorithm on decile bins.
 */
export function isotonicRegression(labels: Label[]): IsotonicKnot[] {
  if (labels.length === 0) return [];

  // Start from reliability bins (which already stabilise the input).
  const bins = reliabilityBins(labels, 10).filter((b) => b.count > 0);
  if (bins.length === 0) return [];

  // PAVA: collapse adjacent violators.
  type Block = {
    scoreSum: number;
    outcomeSum: number;
    weight: number;
    lower: number;
    upper: number;
  };
  const blocks: Block[] = bins.map((b) => ({
    scoreSum: b.mean_score * b.count,
    outcomeSum: b.mean_outcome * b.count,
    weight: b.count,
    lower: b.bin_lower,
    upper: b.bin_upper,
  }));

  let i = 0;
  while (i < blocks.length - 1) {
    const a = blocks[i]!;
    const b = blocks[i + 1]!;
    const aMean = a.outcomeSum / a.weight;
    const bMean = b.outcomeSum / b.weight;
    if (aMean <= bMean) {
      i += 1;
      continue;
    }
    // Violation — merge a and b.
    blocks[i] = {
      scoreSum: a.scoreSum + b.scoreSum,
      outcomeSum: a.outcomeSum + b.outcomeSum,
      weight: a.weight + b.weight,
      lower: a.lower,
      upper: b.upper,
    };
    blocks.splice(i + 1, 1);
    if (i > 0) i -= 1;
  }

  return blocks.map((b) => ({
    score_lower: b.lower,
    score_upper: b.upper,
    calibrated_prob: b.outcomeSum / b.weight,
    weight: b.weight,
  }));
}

// -----------------------------------------------------------------------------
// Calibration state
// -----------------------------------------------------------------------------

export type CalibrationStatus = 'heuristic' | 'calibrated';

export interface CalibrationState {
  state: CalibrationStatus;
  labels_used: number;
  ece_holdout: number | null;
  min_labels: number;
  target_ece: number;
  note: string;
}

export interface CalibrationStateOptions {
  minLabels?: number;
  targetECE?: number;
  holdoutFraction?: number;
  numBins?: number;
}

/**
 * PRD §8.11: the score stays labelled "heuristic" until:
 *   1. STRICTLY MORE THAN `minLabels` labelled claims exist
 *      (default minLabels = 500 → need ≥ 501 to qualify).
 *      The strict bound is the safety-first reading of L10 and the
 *      T-07.4 contract: exactly `minLabels` labels must NOT switch.
 *   2. Holdout ECE ≤ `targetECE` (default 0.10).
 */
export function computeCalibrationState(
  labels: Label[],
  opts: CalibrationStateOptions = {},
): CalibrationState {
  const minLabels = opts.minLabels ?? 500;
  const targetECE = opts.targetECE ?? 0.10;
  const holdoutFraction = opts.holdoutFraction ?? 0.3;
  const numBins = opts.numBins ?? 10;

  // STRICT bound: at exactly minLabels labels, stay heuristic.
  // This is the T-07.4 boundary test:
  //   computeCalibrationState(labelsOfSize1000, {minLabels: 1000}) → heuristic
  if (labels.length <= minLabels) {
    return {
      state: 'heuristic',
      labels_used: labels.length,
      ece_holdout: null,
      min_labels: minLabels,
      target_ece: targetECE,
      note: `Heuristic: ${labels.length} of ${minLabels + 1} labels needed.`,
    };
  }

  const holdout = deterministicSplit(labels, holdoutFraction);
  if (holdout.length === 0) {
    return {
      state: 'heuristic',
      labels_used: labels.length,
      ece_holdout: null,
      min_labels: minLabels,
      target_ece: targetECE,
      note: 'Heuristic: holdout split is empty.',
    };
  }

  const ece = computeECE(holdout, numBins);
  const passed = ece <= targetECE;
  return {
    state: passed ? 'calibrated' : 'heuristic',
    labels_used: labels.length,
    ece_holdout: ece,
    min_labels: minLabels,
    target_ece: targetECE,
    note: passed
      ? `Calibrated on ${labels.length} claims (holdout ECE ${(ece * 100).toFixed(1)}%).`
      : `Heuristic: holdout ECE ${(ece * 100).toFixed(1)}% exceeds target ${(targetECE * 100).toFixed(1)}%.`,
  };
}

// -----------------------------------------------------------------------------
// Miss rate on high-confidence claims (PRD §8.8)
// -----------------------------------------------------------------------------

export interface MissRate {
  threshold: number;
  high_score_count: number;
  high_score_wrong: number;
  miss_rate: number;
}

/**
 * PRD §8.8: "If claims scoring 85 or more are wrong more than 5 percent of
 * the time, the weekly bench raises the E and S thresholds and reports the
 * change."
 */
export function computeMissRate(
  labels: Label[],
  opts: { threshold?: number } = {},
): MissRate {
  const threshold = opts.threshold ?? 85;
  const high = labels.filter((l) => l.score >= threshold);
  const wrong = high.filter((l) => l.outcome === 'incorrect').length;
  return {
    threshold,
    high_score_count: high.length,
    high_score_wrong: wrong,
    miss_rate: high.length === 0 ? 0 : wrong / high.length,
  };
}

export function shouldRaiseThresholds(
  labels: Label[],
  opts: { threshold?: number; maxMissRate?: number } = {},
): boolean {
  const maxMissRate = opts.maxMissRate ?? 0.05;
  const mr = computeMissRate(labels, { threshold: opts.threshold });
  if (mr.high_score_count === 0) return false;
  return mr.miss_rate > maxMissRate;
}

// -----------------------------------------------------------------------------
// Deterministic split (FNV-1a on claim_id)
// -----------------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function deterministicSplit(
  labels: Label[],
  holdoutFraction: number,
): Label[] {
  const threshold = Math.round(holdoutFraction * 1000);
  const out: Label[] = [];
  for (const l of labels) {
    const bucket = fnv1a(l.claim_id) % 1000;
    if (bucket < threshold) out.push(l);
  }
  return out;
}
// === FILE END ===