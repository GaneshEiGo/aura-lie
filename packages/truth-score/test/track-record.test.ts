// === FILE START ===
// packages/truth-score/test/track-record.test.ts
// PRD 8.11 · FR-TRUTH-21 · T-07.
//
// T-07 gate: ECE ≤ 0.10 on a well-calibrated set; fails on a biased set.
// Plus per-bin reliability diagram correctness.

import { describe, it, expect } from 'vitest';
import { TrackRecord, type CalibrationPair } from '../src/track-record.js';

// -----------------------------------------------------------------------------
// Synthetic calibration sets
// -----------------------------------------------------------------------------

/**
 * Perfectly calibrated: for each of 10 bins, predicted score = bin midpoint,
 * and actual accuracy = midpoint / 100. ECE ≈ 0.
 */
function perfectSet(nPerBin: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  let id = 0;
  for (let bin = 0; bin < 10; bin++) {
    const midpoint = bin * 10 + 5; // 5, 15, ..., 95
    const correctCount = Math.round((midpoint / 100) * nPerBin);
    for (let i = 0; i < nPerBin; i++) {
      pairs.push({
        claimId: `c${id++}`,
        predictedScore: midpoint,
        actualCorrect: i < correctCount,
        labelledAt: 1_700_000_000_000,
      });
    }
  }
  return pairs;
}

/**
 * Always 50% correct regardless of predicted score. ECE ≈ 0.25.
 */
function biasedSet(nPerBin: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  let id = 0;
  for (let bin = 0; bin < 10; bin++) {
    const midpoint = bin * 10 + 5;
    const correctCount = Math.round(nPerBin * 0.5);
    for (let i = 0; i < nPerBin; i++) {
      pairs.push({
        claimId: `c${id++}`,
        predictedScore: midpoint,
        actualCorrect: i < correctCount,
        labelledAt: 1_700_000_000_000,
      });
    }
  }
  return pairs;
}

/**
 * 20% too optimistic at every bin. ECE ≈ 0.20 (with edge clamping).
 */
function overconfidentSet(nPerBin: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  let id = 0;
  for (let bin = 0; bin < 10; bin++) {
    const midpoint = bin * 10 + 5;
    const target = Math.max(0, Math.min(1, midpoint / 100 - 0.2));
    const correctCount = Math.round(target * nPerBin);
    for (let i = 0; i < nPerBin; i++) {
      pairs.push({
        claimId: `c${id++}`,
        predictedScore: midpoint,
        actualCorrect: i < correctCount,
        labelledAt: 1_700_000_000_000,
      });
    }
  }
  return pairs;
}

// =============================================================================
// Basic operations
// =============================================================================

describe('TrackRecord — basic operations', () => {
  it('starts empty', () => {
    const tr = new TrackRecord();
    expect(tr.getLabelCount()).toBe(0);
  });

  it('addLabel adds a pair', () => {
    const tr = new TrackRecord({ now: () => 1_700_000_000_000 });
    tr.addLabel('c1', 92, true);
    expect(tr.getLabelCount()).toBe(1);
    const pair = tr.getAllLabels()[0];
    expect(pair.claimId).toBe('c1');
    expect(pair.predictedScore).toBe(92);
    expect(pair.actualCorrect).toBe(true);
  });

  it('upsert replaces for duplicate claimId', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 92, true);
    tr.addLabel('c1', 92, false); // replace
    expect(tr.getLabelCount()).toBe(1);
    expect(tr.getAllLabels()[0].actualCorrect).toBe(false);
  });

  it('removeLabel removes', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 92, true);
    expect(tr.removeLabel('c1')).toBe(true);
    expect(tr.getLabelCount()).toBe(0);
    expect(tr.removeLabel('c1')).toBe(false); // already gone
  });

  it('hasLabel returns true/false', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 92, true);
    expect(tr.hasLabel('c1')).toBe(true);
    expect(tr.hasLabel('c2')).toBe(false);
  });

  it('rejects empty claimId', () => {
    const tr = new TrackRecord();
    expect(() => tr.addLabel('', 92, true)).toThrow(/claimId/);
  });

  it('rejects out-of-range predictedScore', () => {
    const tr = new TrackRecord();
    expect(() => tr.addLabel('c1', -1, true)).toThrow(/0\.\.100/);
    expect(() => tr.addLabel('c1', 101, true)).toThrow(/0\.\.100/);
    expect(() => tr.addLabel('c1', NaN, true)).toThrow(/0\.\.100/);
  });
});

// =============================================================================
// Calibration — empty
// =============================================================================

describe('getCalibration — empty', () => {
  it('empty record yields ECE = 0, size = 0, gate passes (vacuous)', () => {
    const tr = new TrackRecord();
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(0);
    expect(c.ece).toBe(0);
    expect(c.meetsT07Gate).toBe(true);
    expect(c.bins.length).toBe(10);
    expect(c.bins.every((b) => b.count === 0)).toBe(true);
  });
});

// =============================================================================
// T-07 GATE — real calibration behaviour
// =============================================================================

describe('T-07 gate — calibration curve', () => {
  it('perfectly calibrated set → ECE ≈ 0, gate passes', () => {
    const tr = new TrackRecord();
    for (const p of perfectSet(100)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(1000);
    expect(c.ece).toBeLessThanOrEqual(0.02);
    expect(c.meetsT07Gate).toBe(true);
  });

  it('biased set (50% always correct) → ECE > 0.10, gate FAILS', () => {
    const tr = new TrackRecord();
    for (const p of biasedSet(100)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(1000);
    expect(c.ece).toBeGreaterThan(0.10);
    expect(c.meetsT07Gate).toBe(false);
  });

  it('overconfident set (20% too optimistic) → ECE ≈ 0.20, gate FAILS', () => {
    const tr = new TrackRecord();
    for (const p of overconfidentSet(100)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.ece).toBeGreaterThan(0.10);
    expect(c.meetsT07Gate).toBe(false);
  });

  it('T-07 GATE: 1000 perfectly calibrated labels → gate passes', () => {
    const tr = new TrackRecord();
    for (const p of perfectSet(100)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(1000);
    expect(c.ece).toBeLessThanOrEqual(0.10);
    expect(c.meetsT07Gate).toBe(true);
  });
});

// =============================================================================
// Reliability diagram correctness
// =============================================================================

describe('getCalibration — reliability diagram', () => {
  it('10 bins by default, each 10 wide', () => {
    const tr = new TrackRecord();
    for (const p of perfectSet(10)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.bins.length).toBe(10);
    expect(c.bins[0].rangeStart).toBe(0);
    expect(c.bins[0].rangeEnd).toBe(10);
    expect(c.bins[9].rangeStart).toBe(90);
    expect(c.bins[9].rangeEnd).toBe(100);
  });

  it('each bin reports count, correctCount, meanPredicted, actualAccuracy', () => {
    const tr = new TrackRecord();
    // 10 labels, all in bin [90,100), all correct
    for (let i = 0; i < 10; i++) {
      tr.addLabel(`c${i}`, 95, true);
    }
    const c = tr.getCalibration();
    const bin9 = c.bins[9];
    expect(bin9.count).toBe(10);
    expect(bin9.correctCount).toBe(10);
    expect(bin9.meanPredicted).toBeCloseTo(0.95, 2);
    expect(bin9.actualAccuracy).toBe(1);
    // Other bins empty
    for (let i = 0; i < 9; i++) {
      expect(c.bins[i].count).toBe(0);
    }
  });

  it('score exactly 100 goes into the last bin', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 100, true);
    const c = tr.getCalibration();
    expect(c.bins[9].count).toBe(1);
    expect(c.bins[0].count).toBe(0);
  });

  it('score exactly 0 goes into the first bin', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 0, false);
    const c = tr.getCalibration();
    expect(c.bins[0].count).toBe(1);
    expect(c.bins[0].meanPredicted).toBe(0);
    expect(c.bins[0].actualAccuracy).toBe(0);
  });

  it('custom bin count (5 bins)', () => {
    const tr = new TrackRecord();
    tr.addLabel('c1', 92, true);
    const c = tr.getCalibration(5);
    expect(c.bins.length).toBe(5);
    expect(c.bins[4].rangeStart).toBe(80);
    expect(c.bins[4].rangeEnd).toBe(100);
  });

  it('rejects invalid bin count', () => {
    const tr = new TrackRecord();
    expect(() => tr.getCalibration(0)).toThrow(/binsCount/);
    expect(() => tr.getCalibration(-1)).toThrow(/binsCount/);
    expect(() => tr.getCalibration(1.5)).toThrow(/binsCount/);
  });
});

// =============================================================================
// meetsTarget — stricter 0.08 + 500 samples
// =============================================================================

describe('meetsTarget', () => {
  it('perfect 1000-sample set meets target', () => {
    const tr = new TrackRecord();
    for (const p of perfectSet(100)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(1000);
    expect(c.ece).toBeLessThanOrEqual(0.08);
    expect(c.meetsTarget).toBe(true);
  });

  it('perfect but small set (100) does NOT meet target (needs 500)', () => {
    const tr = new TrackRecord();
    for (const p of perfectSet(10)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(100);
    expect(c.ece).toBeLessThanOrEqual(0.10);
    expect(c.meetsT07Gate).toBe(true);
    // ECE is fine but sample size is too small
    expect(c.meetsTarget).toBe(false);
  });
});

// =============================================================================
// T-07 GATE — 500-sample minimum
// =============================================================================

describe('T-07 — sample-size awareness', () => {
  it('well-calibrated 500-sample set meets T-07', () => {
    const tr = new TrackRecord();
    // 50 per bin × 10 bins = 500
    for (const p of perfectSet(50)) {
      tr.addLabel(p.claimId, p.predictedScore, p.actualCorrect);
    }
    const c = tr.getCalibration();
    expect(c.sampleSize).toBe(500);
    expect(c.meetsT07Gate).toBe(true);
    expect(c.meetsTarget).toBe(true);
  });
});
// === FILE END === 