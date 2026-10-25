// === FILE START ===
// packages/track-record/test/t07-calibration-replay-v2.test.ts
// PRD §8.11 · §15.2 T-07 · FR-TRUTH-21 · FR-TRACET-03.
//
// T-07 gate:
//   · Reliability diagram is well-formed (bins in order, [0,10)..[90,100])
//   · ECE computation matches the analytic definition
//   · Perfectly calibrated data → ECE ≤ 0.10
//   · Mis-calibrated data → ECE > 0.10
//   · Isotonic regression is monotone non-decreasing
//   · Calibration state: heuristic until 500 labels + holdout ECE ≤ 0.10
//   · Miss rate ≥ 85 computed correctly; shouldRaiseThresholds when > 5%
//   · Replay is deterministic (identical input → identical output)
//   · Replay does not mutate the input events

import { describe, it, expect } from 'vitest';
import {
  reliabilityBins,
  computeECE,
  isotonicRegression,
  computeCalibrationState,
  computeMissRate,
  shouldRaiseThresholds,
  type Label,
} from '../src/calibration-v2.js';
import {
  replayTurn,
  replaySignature,
  type ReplayEvent,
} from '../src/replay-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/**
 * Perfectly-calibrated synthetic data: for each score bin [10b, 10b+9],
 * generate 100 samples. Within a bin, mark `round(mean_score)` of them
 * correct. Result: mean_outcome ≈ mean_score/100 → ECE ≈ 0.
 */
function wellCalibratedLabels(): Label[] {
  const out: Label[] = [];
  for (let b = 0; b < 10; b++) {
    for (let i = 0; i < 100; i++) {
      const score = b * 10 + i % 10;
      const correctCount = b * 10 + 5; // rounds mean_score within bin
      const id = `well_${b}_${i}`;
      out.push({
        claim_id: id,
        score,
        outcome: i < correctCount ? 'correct' : 'incorrect',
      });
    }
  }
  return out;
}

/**
 * Massively mis-calibrated: every outcome is "correct" regardless of score.
 * Low scores are confidently wrong → ECE >> 0.10.
 */
function misCalibratedLabels(): Label[] {
  const out: Label[] = [];
  for (let b = 0; b < 10; b++) {
    for (let i = 0; i < 100; i++) {
      out.push({
        claim_id: `mis_${b}_${i}`,
        score: b * 10 + i % 10,
        outcome: 'correct',
      });
    }
  }
  return out;
}

function fixedEvents(): ReplayEvent[] {
  return [
    {
      seq: 1,
      t: 'meta',
      mode: 'think',
      persona: 'aura-lie',
      sensitivity: 'S0',
      riskTier: 1,
    },
    { seq: 2, t: 'token', delta: 'The answer ' },
    { seq: 3, t: 'token', delta: 'is ' },
    { seq: 4, t: 'token', delta: '42.' },
    {
      seq: 5,
      t: 'claim',
      id: 'c1',
      text: 'The answer is 42.',
      claimType: 'numeric',
      importance: 0.9,
    },
    {
      seq: 6,
      t: 'source',
      id: 's1',
      title: 'Wikipedia: 42',
      domain: 'wikipedia.org',
      tier: 90,
    },
    { seq: 7, t: 'score', claimId: 'c1', score: 92, status: 'VERIFIED' },
    {
      seq: 8,
      t: 'summary',
      overall: 92,
      checked: 1,
      checkable: 1,
      chip: 'VERIFIED',
    },
    { seq: 9, t: 'done', elapsedMs: 1200, calls: 3, tokens: 800, costInr: 0 },
  ];
}

// =============================================================================
// T-07.1 — Reliability diagram
// =============================================================================

describe('T-07.1 — reliabilityBins', () => {
  it('produces 10 bins for the default', () => {
    const bins = reliabilityBins([]);
    expect(bins.length).toBe(10);
    expect(bins[0]!.bin_lower).toBe(0);
    expect(bins[0]!.bin_upper).toBe(10);
    expect(bins[9]!.bin_lower).toBe(90);
    expect(bins[9]!.bin_upper).toBe(100);
  });

  it('bins are in ascending order', () => {
    const bins = reliabilityBins(wellCalibratedLabels());
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i]!.bin_lower).toBe(bins[i - 1]!.bin_upper);
    }
  });

  it('counts per bin sum to total label count', () => {
    const labels = wellCalibratedLabels();
    const bins = reliabilityBins(labels);
    const total = bins.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(labels.length);
  });

  it('boundary scores land in the correct bin (100 → last bin)', () => {
    const labels: Label[] = [
      { claim_id: 'a', score: 0, outcome: 'correct' },
      { claim_id: 'b', score: 99, outcome: 'correct' },
      { claim_id: 'c', score: 100, outcome: 'correct' },
    ];
    const bins = reliabilityBins(labels);
    expect(bins[0]!.count).toBe(1);
    expect(bins[9]!.count).toBe(2);
  });

  it('empty labels → all bins have count 0', () => {
    const bins = reliabilityBins([]);
    for (const b of bins) expect(b.count).toBe(0);
  });
});

// =============================================================================
// T-07.2 — ECE
// =============================================================================

describe('T-07.2 — computeECE', () => {
  it('empty labels → ECE 0', () => {
    expect(computeECE([])).toBe(0);
  });

  it('perfectly calibrated data → ECE ≤ 0.10 (the gate)', () => {
    const ece = computeECE(wellCalibratedLabels());
    expect(ece).toBeLessThanOrEqual(0.10);
  });

  it('perfectly calibrated data → ECE is tiny (≤ 0.02)', () => {
    const ece = computeECE(wellCalibratedLabels());
    expect(ece).toBeLessThanOrEqual(0.02);
  });

  it('mis-calibrated data → ECE > 0.10 (fails the gate)', () => {
    const ece = computeECE(misCalibratedLabels());
    expect(ece).toBeGreaterThan(0.10);
  });

  it('ECE is in [0, 1] for any input', () => {
    const ece1 = computeECE(wellCalibratedLabels());
    const ece2 = computeECE(misCalibratedLabels());
    expect(ece1).toBeGreaterThanOrEqual(0);
    expect(ece1).toBeLessThanOrEqual(1);
    expect(ece2).toBeGreaterThanOrEqual(0);
    expect(ece2).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// T-07.3 — Isotonic regression
// =============================================================================

describe('T-07.3 — isotonicRegression', () => {
  it('returns knots sorted by score_lower', () => {
    const knots = isotonicRegression(wellCalibratedLabels());
    for (let i = 1; i < knots.length; i++) {
      expect(knots[i]!.score_lower).toBeGreaterThanOrEqual(
        knots[i - 1]!.score_lower,
      );
    }
  });

  it('calibrated_prob is monotone non-decreasing', () => {
    const knots = isotonicRegression(wellCalibratedLabels());
    for (let i = 1; i < knots.length; i++) {
      expect(knots[i]!.calibrated_prob).toBeGreaterThanOrEqual(
        knots[i - 1]!.calibrated_prob,
      );
    }
  });

  it('calibrated_prob is in [0, 1]', () => {
    const knots = isotonicRegression(wellCalibratedLabels());
    for (const k of knots) {
      expect(k.calibrated_prob).toBeGreaterThanOrEqual(0);
      expect(k.calibrated_prob).toBeLessThanOrEqual(1);
    }
  });

  it('empty labels → empty knots', () => {
    expect(isotonicRegression([])).toEqual([]);
  });

  it('total weight of knots equals total label count (within decile binning)', () => {
    const labels = wellCalibratedLabels();
    const knots = isotonicRegression(labels);
    const totalWeight = knots.reduce((a, k) => a + k.weight, 0);
    expect(totalWeight).toBe(labels.length);
  });
});

// =============================================================================
// T-07.4 — Calibration state
// =============================================================================

describe('T-07.4 — computeCalibrationState', () => {
  it('returns heuristic below 500 labels', () => {
    const state = computeCalibrationState(wellCalibratedLabels().slice(0, 100));
    expect(state.state).toBe('heuristic');
    expect(state.labels_used).toBe(100);
    expect(state.min_labels).toBe(500);
  });

  it('switches to calibrated at ≥ 500 labels with good ECE', () => {
    const state = computeCalibrationState(wellCalibratedLabels());
    expect(state.state).toBe('calibrated');
    expect(state.ece_holdout).not.toBeNull();
    expect(state.ece_holdout!).toBeLessThanOrEqual(0.10);
  });

  it('stays heuristic with ≥ 500 labels when ECE > 0.10', () => {
    const state = computeCalibrationState(misCalibratedLabels());
    expect(state.state).toBe('heuristic');
    expect(state.ece_holdout!).toBeGreaterThan(0.10);
  });

  it('custom minLabels threshold is honoured', () => {
    const state = computeCalibrationState(wellCalibratedLabels(), {
      minLabels: 1000,
    });
    expect(state.state).toBe('heuristic');
    expect(state.min_labels).toBe(1000);
  });

  it('note string mentions the state', () => {
    const state = computeCalibrationState(wellCalibratedLabels());
    expect(state.note).toMatch(/Calibrated on \d+ claims/);
  });
});

// =============================================================================
// T-07.5 — Miss rate and threshold raising (PRD §8.8)
// =============================================================================

describe('T-07.5 — computeMissRate', () => {
  it('no labels → miss_rate 0', () => {
    const mr = computeMissRate([]);
    expect(mr.miss_rate).toBe(0);
    expect(mr.high_score_count).toBe(0);
  });

  it('score >= 85 labels counted', () => {
    const labels: Label[] = [
      { claim_id: 'a', score: 90, outcome: 'incorrect' },
      { claim_id: 'b', score: 85, outcome: 'correct' },
      { claim_id: 'c', score: 70, outcome: 'incorrect' },
    ];
    const mr = computeMissRate(labels);
    expect(mr.high_score_count).toBe(2);
    expect(mr.high_score_wrong).toBe(1);
    expect(mr.miss_rate).toBe(0.5);
  });

  it('default threshold is 85', () => {
    const mr = computeMissRate([{ claim_id: 'a', score: 84, outcome: 'incorrect' }]);
    expect(mr.threshold).toBe(85);
    expect(mr.high_score_count).toBe(0);
  });
});

describe('T-07.5b — shouldRaiseThresholds', () => {
  it('miss rate 0% → no raise', () => {
    const labels: Label[] = Array.from({ length: 20 }, (_, i) => ({
      claim_id: `c${i}`,
      score: 90,
      outcome: 'correct' as const,
    }));
    expect(shouldRaiseThresholds(labels)).toBe(false);
  });

  it('miss rate 4% → no raise (≤ 5%)', () => {
    const labels: Label[] = Array.from({ length: 100 }, (_, i) => ({
      claim_id: `c${i}`,
      score: 90,
      outcome: (i < 4 ? 'incorrect' : 'correct') as 'correct' | 'incorrect',
    }));
    expect(shouldRaiseThresholds(labels)).toBe(false);
  });

  it('miss rate 10% → raise', () => {
    const labels: Label[] = Array.from({ length: 100 }, (_, i) => ({
      claim_id: `c${i}`,
      score: 90,
      outcome: (i < 10 ? 'incorrect' : 'correct') as 'correct' | 'incorrect',
    }));
    expect(shouldRaiseThresholds(labels)).toBe(true);
  });

  it('0 high-score labels → no raise', () => {
    const labels: Label[] = [
      { claim_id: 'a', score: 50, outcome: 'incorrect' },
      { claim_id: 'b', score: 60, outcome: 'correct' },
    ];
    expect(shouldRaiseThresholds(labels)).toBe(false);
  });
});

// =============================================================================
// T-07.6 — Replay: determinism + purity (GATE)
// =============================================================================

describe('T-07.6 — replayTurn is deterministic and pure', () => {
  it('two replays produce identical signatures', () => {
    const events = fixedEvents();
    const r1 = replayTurn(events);
    const r2 = replayTurn(events);
    expect(replaySignature(r1)).toBe(replaySignature(r2));
  });

  it('replay does not mutate the input events', () => {
    const events = fixedEvents();
    const before = JSON.stringify(events);
    replayTurn(events);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('replay joins all token deltas into the answer', () => {
    const r = replayTurn(fixedEvents());
    expect(r.answer).toBe('The answer is 42.');
  });

  it('replay collects all claims with their scores', () => {
    const r = replayTurn(fixedEvents());
    expect(r.claims.length).toBe(1);
    expect(r.claims[0]!.id).toBe('c1');
    expect(r.claims[0]!.score).toBe(92);
    expect(r.claims[0]!.status).toBe('VERIFIED');
  });

  it('replay collects all sources', () => {
    const r = replayTurn(fixedEvents());
    expect(r.sources.length).toBe(1);
    expect(r.sources[0]!.title).toBe('Wikipedia: 42');
    expect(r.sources[0]!.tier).toBe(90);
  });

  it('replay captures meta and summary and done', () => {
    const r = replayTurn(fixedEvents());
    expect(r.meta).not.toBeNull();
    expect(r.meta!.mode).toBe('think');
    expect(r.summary).not.toBeNull();
    expect(r.summary!.chip).toBe('VERIFIED');
    expect(r.done).not.toBeNull();
    expect(r.done!.costInr).toBe(0);
  });

  it('empty events → empty result', () => {
    const r = replayTurn([]);
    expect(r.answer).toBe('');
    expect(r.claims).toEqual([]);
    expect(r.sources).toEqual([]);
    expect(r.summary).toBeNull();
    expect(r.meta).toBeNull();
    expect(r.done).toBeNull();
    expect(r.event_count).toBe(0);
  });

  it('event_count equals the input length', () => {
    const events = fixedEvents();
    const r = replayTurn(events);
    expect(r.event_count).toBe(events.length);
  });
});
// === FILE END ===