// packages/track-record/src/calibration.ts
// Reliability diagram, ECE, held-out split, and isotonic (PAVA) fit.
// PRD 8.11: "Fit isotonic regression on the score. Publish a reliability
// diagram and ECE."

import type {
  Label,
  ReliabilityBin,
  ReliabilityDiagram,
} from './types.js';

const NUM_BINS = 10;

export function computeReliabilityDiagram(labels: Label[]): ReliabilityDiagram {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < NUM_BINS; i++) {
    bins.push({
      bin: i,
      low: i * 10,
      high: (i + 1) * 10,
      count: 0,
      avgScore: 0,
      accuracy: 0,
    });
  }

  const scoreSums = new Array<number>(NUM_BINS).fill(0);
  const correctCounts = new Array<number>(NUM_BINS).fill(0);

  for (const label of labels) {
    let idx = Math.floor(label.predictedScore / 10);
    if (idx < 0) idx = 0;
    if (idx >= NUM_BINS) idx = NUM_BINS - 1;
    bins[idx].count += 1;
    scoreSums[idx] += label.predictedScore;
    if (label.outcome === 'correct') correctCounts[idx] += 1;
  }

  for (let i = 0; i < NUM_BINS; i++) {
    bins[i].avgScore =
      bins[i].count > 0 ? scoreSums[i] / bins[i].count : 0;
    bins[i].accuracy =
      bins[i].count > 0 ? correctCounts[i] / bins[i].count : 0;
  }

  return { bins, totalLabels: labels.length };
}

export function computeECE(diagram: ReliabilityDiagram): number {
  const total = diagram.totalLabels;
  if (total === 0) return 0;
  let ece = 0;
  for (const bin of diagram.bins) {
    if (bin.count === 0) continue;
    const confidence = bin.avgScore / 100;
    const gap = Math.abs(bin.accuracy - confidence);
    ece += (bin.count / total) * gap;
  }
  return ece;
}

/**
 * Every 5th label (indices 4, 9, 14, ...) becomes the held-out set.
 * Deterministic so tests are reproducible.
 */
export function splitHoldout(labels: Label[]): {
  train: Label[];
  holdout: Label[];
} {
  const train: Label[] = [];
  const holdout: Label[] = [];
  labels.forEach((label, i) => {
    if (i % 5 === 4) holdout.push(label);
    else train.push(label);
  });
  return { train, holdout };
}

/**
 * PAVA (Pool Adjacent Violators) isotonic regression.
 * Produces a monotone non-decreasing fit. Used only when the status
 * has flipped to 'calibrated', to map raw scores onto calibrated
 * probabilities for the reliability diagram overlay.
 */
export function fitIsotonic(
  points: Array<{ x: number; y: number; weight?: number }>,
): Array<{ x: number; y: number; weight: number }> {
  if (points.length === 0) return [];

  interface Block {
    xSum: number;
    ySum: number;
    wSum: number;
  }

  const sorted = [...points]
    .map((p) => ({ x: p.x, y: p.y, w: p.weight ?? 1 }))
    .sort((a, b) => a.x - b.x);

  const blocks: Block[] = sorted.map((p) => ({
    xSum: p.x * p.w,
    ySum: p.y * p.w,
    wSum: p.w,
  }));

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      const a = blocks[i];
      const b = blocks[i + 1];
      const aVal = a.ySum / a.wSum;
      const bVal = b.ySum / b.wSum;
      if (aVal <= bVal) continue;
      blocks[i] = {
        xSum: a.xSum + b.xSum,
        ySum: a.ySum + b.ySum,
        wSum: a.wSum + b.wSum,
      };
      blocks.splice(i + 1, 1);
      merged = true;
      break;
    }
  }

  return blocks.map((b) => ({
    x: b.xSum / b.wSum,
    y: b.ySum / b.wSum,
    weight: b.wSum,
  }));
}