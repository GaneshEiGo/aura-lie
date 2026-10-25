// === FILE START ===
// packages/autonomy/test/weekly-review.test.ts
// PRD §10.7 · F-090 · FR-PRO-09.

import { describe, it, expect } from 'vitest';
import {
  composeWeeklyReview,
  digestWeeklyReview,
  toSingleDigestItem,
  type WeeklyReview,
} from '../src/weekly-review.js';

function sample(): WeeklyReview {
  return {
    week_start: '2026-09-28',
    week_end: '2026-10-04',
    conversations: 12,
    claims_checked: 47,
    open_loops_closed: 3,
    open_loops_remaining: 5,
    stale_memories: 2,
    decisions_made: 1,
    not_useful_notes: 0,
  };
}

describe('composeWeeklyReview', () => {
  it('returns a copy of the input', () => {
    const r = sample();
    const out = composeWeeklyReview(r);
    expect(out).toEqual(r);
    expect(out).not.toBe(r);
  });
});

describe('digestWeeklyReview', () => {
  it('builds a summary line for a normal week', () => {
    const d = digestWeeklyReview(sample());
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.one_line.startsWith('This week:')).toBe(true);
  });

  it('quiet week when every count is zero', () => {
    const r: WeeklyReview = {
      week_start: '2026-09-28',
      week_end: '2026-10-04',
      conversations: 0,
      claims_checked: 0,
      open_loops_closed: 0,
      open_loops_remaining: 0,
      stale_memories: 0,
      decisions_made: 0,
      not_useful_notes: 0,
    };
    const d = digestWeeklyReview(r);
    expect(d.lines).toEqual([]);
    expect(d.one_line).toBe('Quiet week. Nothing to clean up.');
  });

  it('only mentions non-zero fields', () => {
    const r: WeeklyReview = {
      week_start: '2026-09-28',
      week_end: '2026-10-04',
      conversations: 5,
      claims_checked: 0,
      open_loops_closed: 0,
      open_loops_remaining: 0,
      stale_memories: 0,
      decisions_made: 0,
      not_useful_notes: 0,
    };
    const d = digestWeeklyReview(r);
    expect(d.lines).toEqual(['5 conversations']);
  });

  it('one_line caps at three items', () => {
    const r = sample();
    const d = digestWeeklyReview(r);
    const parts = d.one_line.replace('This week: ', '').split(' · ');
    expect(parts.length).toBeLessThanOrEqual(3);
  });
});

describe('toSingleDigestItem', () => {
  it('returns a single {title, one_line} object', () => {
    const item = toSingleDigestItem(sample());
    expect(item.title).toBe('Weekly review');
    expect(item.one_line.length).toBeGreaterThan(0);
  });

  it('is one item, not many (per PRD §10.7)', () => {
    const item = toSingleDigestItem(sample());
    expect(Object.keys(item).sort()).toEqual(['one_line', 'title']);
  });
});
// === FILE END ===