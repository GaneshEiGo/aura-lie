// packages/track-record/src/status.ts
// PRD 8.11 thresholds and FR-TRUTH-21 display rules.
//   - <20 labels         : insufficient-data (page shows "Label 20 claims")
//   - 20..499 labels     : heuristic (curve drawn, but not "calibrated")
//   - >=500 labels + good: calibrated on N claims
//   - >=500 labels + bad : still heuristic

import type { CalibrationStatus, Label, TrackRecordState } from './types.js';
import {
  computeECE,
  computeReliabilityDiagram,
  splitHoldout,
} from './calibration.js';

export const MIN_LABELS_FOR_DISPLAY = 20;      // FR-TRUTH-21
export const MIN_LABELS_FOR_CALIBRATION = 500; // PRD 8.11
export const DEFAULT_ECE_THRESHOLD = 0.10;     // PRD 8.11, first target

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ComputeStatusOptions {
  threshold?: number;
  now?: number;
}

export function computeStatus(
  labels: Label[],
  options: ComputeStatusOptions = {},
): TrackRecordState {
  const threshold = options.threshold ?? DEFAULT_ECE_THRESHOLD;
  const now = options.now ?? Date.now();
  const weekStart = now - WEEK_MS;

  const weeklyWrongCount = labels.filter(
    (l) => l.outcome === 'incorrect' && l.labelledAt >= weekStart,
  ).length;
  const totalWrongCount = labels.filter(
    (l) => l.outcome === 'incorrect',
  ).length;

  if (labels.length < MIN_LABELS_FOR_DISPLAY) {
    return {
      status: 'insufficient-data',
      labelCount: labels.length,
      ece: 0,
      eceHoldout: 0,
      holdoutSize: 0,
      threshold,
      weeklyWrongCount,
      totalWrongCount,
      labelText: `Label ${MIN_LABELS_FOR_DISPLAY} claims to see calibration.`,
      lastUpdated: now,
    };
  }

  const diagram = computeReliabilityDiagram(labels);
  const ece = computeECE(diagram);

  const { holdout } = splitHoldout(labels);
  const holdoutDiagram = computeReliabilityDiagram(holdout);
  const eceHoldout = computeECE(holdoutDiagram);

  let status: CalibrationStatus = 'heuristic';
  let labelText = 'heuristic';

  if (
    labels.length >= MIN_LABELS_FOR_CALIBRATION &&
    eceHoldout <= threshold
  ) {
    status = 'calibrated';
    labelText = `calibrated on ${labels.length} claims`;
  }

  return {
    status,
    labelCount: labels.length,
    ece,
    eceHoldout,
    holdoutSize: holdout.length,
    threshold,
    weeklyWrongCount,
    totalWrongCount,
    labelText,
    lastUpdated: now,
  };
}