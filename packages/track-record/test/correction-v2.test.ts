// === FILE START ===
// packages/track-record/test/correction-v2.test.ts
// PRD §8.8 · §8.11 · FR-TRUTH-21.

import { describe, it, expect } from 'vitest';
import {
  recordCorrection,
  correctionsToLabels,
  correctionOutcome,
  weeklySummary,
  type Correction,
} from '../src/correction-v2.js';
import type { Label } from '../src/calibration-v2.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const iso = (daysAgo: number) =>
  new Date(T0 - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function fixedId(): () => string {
  let n = 0;
  return () => `corr-${++n}`;
}

describe('recordCorrection', () => {
  it('appends a correction and returns a new array', () => {
    const orig: Correction[] = [];
    const next = recordCorrection(orig, {
      id: 'c1',
      claim_id: 'claim-1',
      kind: 'wrong',
      note: null,
      at: iso(0),
    });
    expect(next.length).toBe(1);
    expect(orig.length).toBe(0); // not mutated
  });
});

describe('correctionOutcome', () => {
  it('wrong → incorrect', () => {
    expect(correctionOutcome('wrong')).toBe('incorrect');
  });
  it('right → correct', () => {
    expect(correctionOutcome('right')).toBe('correct');
  });
  it('thumbs-down → incorrect', () => {
    expect(correctionOutcome('thumbs-down')).toBe('incorrect');
  });
  it('thumbs-up → correct', () => {
    expect(correctionOutcome('thumbs-up')).toBe('correct');
  });
  it('edit → incorrect', () => {
    expect(correctionOutcome('edit')).toBe('incorrect');
  });
});

describe('correctionsToLabels', () => {
  it('converts corrections to labels using the score map', () => {
    const corrections: Correction[] = [
      { id: 'c1', claim_id: 'claim-1', kind: 'wrong', note: null, at: iso(0) },
      { id: 'c2', claim_id: 'claim-2', kind: 'right', note: null, at: iso(0) },
    ];
    const scores = { 'claim-1': 90, 'claim-2': 80 };
    const labels = correctionsToLabels(corrections, scores);
    expect(labels.length).toBe(2);
    expect(labels.find((l) => l.claim_id === 'claim-1')!.outcome).toBe('incorrect');
    expect(labels.find((l) => l.claim_id === 'claim-2')!.outcome).toBe('correct');
  });

  it('skips corrections whose claim has no score', () => {
    const corrections: Correction[] = [
      { id: 'c1', claim_id: 'claim-1', kind: 'wrong', note: null, at: iso(0) },
      { id: 'c2', claim_id: 'unknown', kind: 'wrong', note: null, at: iso(0) },
    ];
    const scores = { 'claim-1': 90 };
    const labels = correctionsToLabels(corrections, scores);
    expect(labels.length).toBe(1);
    expect(labels[0]!.claim_id).toBe('claim-1');
  });

  it('empty corrections → empty labels', () => {
    expect(correctionsToLabels([], {})).toEqual([]);
  });
});

describe('weeklySummary', () => {
  const allLabels: Label[] = Array.from({ length: 100 }, (_, i) => ({
    claim_id: `c${i}`,
    score: i < 20 ? 90 : 60,
    outcome: (i < 15 ? 'incorrect' : 'correct') as 'correct' | 'incorrect',
  }));

  it('reports corrections in the last 7 days', () => {
    const corrections: Correction[] = [
      { id: 'c1', claim_id: 'a', kind: 'wrong', note: null, at: iso(1) },
      { id: 'c2', claim_id: 'b', kind: 'wrong', note: null, at: iso(3) },
      { id: 'c3', claim_id: 'c', kind: 'wrong', note: null, at: iso(10) }, // outside
    ];
    const s = weeklySummary(allLabels, corrections, {
      now: new Date(T0).toISOString(),
    });
    expect(s.corrections_received).toBe(2);
  });

  it('respects minLabelsForMessage (default 20)', () => {
    const few: Correction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      claim_id: `c${i}`,
      kind: 'wrong' as const,
      note: null,
      at: iso(1),
    }));
    const s = weeklySummary(allLabels, few, { now: new Date(T0).toISOString() });
    expect(s.message).toBe('');
  });

  it('produces the PRD §8.8 message when ≥ 20 corrections in window', () => {
    const many: Correction[] = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      claim_id: `c${i}`,
      kind: i < 3 ? ('wrong' as const) : ('right' as const),
      note: null,
      at: iso(1),
    }));
    const s = weeklySummary(allLabels, many, { now: new Date(T0).toISOString() });
    expect(s.message).toMatch(/I was wrong \d+ times this week\./);
    expect(s.labelled_incorrect).toBe(3);
  });

  it('message says "Nothing was wrong" when 0 incorrect', () => {
    const many: Correction[] = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      claim_id: `c${i}`,
      kind: 'right' as const,
      note: null,
      at: iso(1),
    }));
    const s = weeklySummary(allLabels, many, { now: new Date(T0).toISOString() });
    expect(s.message).toBe('Nothing was wrong this week.');
  });

  it('computes miss_rate_85plus over allLabels', () => {
    const s = weeklySummary(allLabels, [], { now: new Date(T0).toISOString() });
    // 20 high-score labels, 15 wrong → 75% miss rate
    expect(s.miss_rate_85plus).toBeCloseTo(0.75, 5);
  });

  it('singular wording for exactly 1 wrong', () => {
    const corrections: Correction[] = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      claim_id: `c${i}`,
      kind: i === 0 ? ('wrong' as const) : ('right' as const),
      note: null,
      at: iso(1),
    }));
    const s = weeklySummary(allLabels, corrections, {
      now: new Date(T0).toISOString(),
    });
    expect(s.message).toBe('I was wrong 1 time this week.');
  });
});
// === FILE END ===