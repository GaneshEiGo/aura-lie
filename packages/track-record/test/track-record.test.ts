// packages/track-record/test/track-record.test.ts
import { describe, it, expect } from 'vitest';
import {
  LabelStore,
  computeReliabilityDiagram,
  computeECE,
  fitIsotonic,
  computeStatus,
  MIN_LABELS_FOR_DISPLAY,
  MIN_LABELS_FOR_CALIBRATION,
} from '../src/index.js';
import type { Label } from '../src/types.js';

function makeLabel(
  score: number,
  outcome: 'correct' | 'incorrect',
  at: number,
  idx: number,
): Label {
  return {
    id: `lbl-${idx}`,
    claimId: `c-${idx}`,
    turnId: `t-${idx}`,
    predictedScore: score,
    outcome,
    labelledAt: at,
  };
}

function makeLabels(
  count: number,
  scoreFn: (i: number) => number,
  correctFn: (i: number) => boolean,
  atFn: (i: number) => number = () => Date.now(),
): Label[] {
  const labels: Label[] = [];
  for (let i = 0; i < count; i++) {
    labels.push(
      makeLabel(scoreFn(i), correctFn(i) ? 'correct' : 'incorrect', atFn(i), i),
    );
  }
  return labels;
}

describe('Track Record (PRD 8.11, FR-TRUTH-21, F-256)', () => {
  it('reports insufficient-data with 0 labels', () => {
    const state = computeStatus([]);
    expect(state.status).toBe('insufficient-data');
    expect(state.labelCount).toBe(0);
    expect(state.weeklyWrongCount).toBe(0);
  });

  it('reports insufficient-data just below the display threshold', () => {
    const labels = makeLabels(MIN_LABELS_FOR_DISPLAY - 1, () => 80, (i) => i % 2 === 0);
    const state = computeStatus(labels);
    expect(state.status).toBe('insufficient-data');
  });

  it('reports heuristic at exactly the display threshold with diagram', () => {
    const labels = makeLabels(MIN_LABELS_FOR_DISPLAY, () => 70, (i) => i < 14);
    const state = computeStatus(labels);
    expect(state.status).toBe('heuristic');
    expect(state.labelCount).toBe(MIN_LABELS_FOR_DISPLAY);
    expect(state.ece).toBeGreaterThanOrEqual(0);
    expect(state.labelText).toBe('heuristic');
  });

  it('stays heuristic just below the calibration threshold', () => {
    const labels = makeLabels(MIN_LABELS_FOR_CALIBRATION - 1, () => 80, (i) => i < 400);
    const state = computeStatus(labels);
    expect(state.status).toBe('heuristic');
    expect(state.labelText).toBe('heuristic');
  });

  it('flips to calibrated at 500 labels with well-calibrated outcomes', () => {
    // 500 labels at score 80, 80% correct.
    // Held-out split: every 5th label. 100 holdout, 80 correct of 100.
    // Holdout accuracy 0.80, confidence 0.80, gap 0 => ECE 0 <= 0.10.
    const labels = makeLabels(MIN_LABELS_FOR_CALIBRATION, () => 80, (i) => i < 400);
    const state = computeStatus(labels);
    expect(state.status).toBe('calibrated');
    expect(state.labelText).toContain('calibrated on');
    expect(state.labelText).toContain(String(MIN_LABELS_FOR_CALIBRATION));
  });

  it('stays heuristic at 500 labels with poorly-calibrated outcomes', () => {
    // Score 90, only 50% correct => ECE ~0.40 > 0.10.
    const labels = makeLabels(MIN_LABELS_FOR_CALIBRATION, () => 90, (i) => i < 250);
    const state = computeStatus(labels);
    expect(state.status).toBe('heuristic');
  });

  it('bins labels into the 10 partitions correctly', () => {
    const at = Date.now();
    const labels: Label[] = [
      makeLabel(5, 'correct', at, 0),
      makeLabel(15, 'incorrect', at, 1),
      makeLabel(55, 'correct', at, 2),
      makeLabel(55, 'correct', at, 3),
      makeLabel(95, 'incorrect', at, 4),
    ];
    const diagram = computeReliabilityDiagram(labels);
    expect(diagram.totalLabels).toBe(5);
    expect(diagram.bins[0].count).toBe(1);
    expect(diagram.bins[1].count).toBe(1);
    expect(diagram.bins[5].count).toBe(2);
    expect(diagram.bins[9].count).toBe(1);
    expect(diagram.bins[5].accuracy).toBe(1);
    expect(diagram.bins[9].accuracy).toBe(0);
  });

  it('computes ECE correctly for a perfectly-calibrated case', () => {
    // 100 labels at score 80, 80% correct. Confidence 0.80, accuracy 0.80 => ECE 0.
    const labels = makeLabels(100, () => 80, (i) => i < 80);
    const diagram = computeReliabilityDiagram(labels);
    const ece = computeECE(diagram);
    expect(ece).toBeCloseTo(0, 5);
  });

  it('counts wrong claims within the last 7 days only', () => {
    const now = Date.now();
    const d = 24 * 60 * 60 * 1000;
    const labels: Label[] = [
      makeLabel(80, 'incorrect', now - 1_000, 0),      // within week
      makeLabel(80, 'incorrect', now - 2 * d, 1),      // within week
      makeLabel(80, 'incorrect', now - 8 * d, 2),      // outside week
      makeLabel(80, 'correct', now - 1_000, 3),
      ...Array.from({ length: 16 }, (_, i) =>
        makeLabel(80, 'correct', now - 1_000, i + 10),
      ),
    ];
    expect(labels.length).toBe(MIN_LABELS_FOR_DISPLAY);
    const state = computeStatus(labels, { now });
    expect(state.weeklyWrongCount).toBe(2);
    expect(state.totalWrongCount).toBe(3);
  });

  it('records a correction when a label is overwritten', () => {
    const store = new LabelStore();
    const first = store.record({
      claimId: 'c1',
      turnId: 't1',
      predictedScore: 80,
      outcome: 'correct',
      at: 1_000,
    });
    expect(first.correction).toBeUndefined();

    const second = store.record({
      claimId: 'c1',
      turnId: 't1',
      predictedScore: 80,
      outcome: 'incorrect',
      at: 2_000,
    });
    expect(second.correction).toBeDefined();
    expect(second.correction!.from).toBe('correct');
    expect(second.correction!.to).toBe('incorrect');
    expect(store.size()).toBe(1);
    expect(store.correctionsList().length).toBe(1);
  });

  it('ignores a repeat of the same outcome (no false correction)', () => {
    const store = new LabelStore();
    store.record({
      claimId: 'c1',
      turnId: 't1',
      predictedScore: 80,
      outcome: 'correct',
      at: 1_000,
    });
    const again = store.record({
      claimId: 'c1',
      turnId: 't1',
      predictedScore: 80,
      outcome: 'correct',
      at: 2_000,
    });
    expect(again.correction).toBeUndefined();
    expect(store.correctionsList().length).toBe(0);
  });

  it('isotonic fit produces a monotonic non-decreasing curve', () => {
    const points = [
      { x: 10, y: 0.9 },
      { x: 20, y: 0.8 },
      { x: 30, y: 0.7 },
      { x: 40, y: 0.6 },
      { x: 50, y: 0.5 },
      { x: 60, y: 0.4 },
      { x: 70, y: 0.3 },
      { x: 80, y: 0.2 },
      { x: 90, y: 0.1 },
      { x: 100, y: 0.0 },
    ];
    const fit = fitIsotonic(points);
    for (let i = 0; i < fit.length - 1; i++) {
      expect(fit[i].y).toBeLessThanOrEqual(fit[i + 1].y + 1e-9);
    }
    // Total weight must be preserved.
    const totalWeight = fit.reduce((s, b) => s + b.weight, 0);
    expect(totalWeight).toBeCloseTo(points.length, 6);
  });
});