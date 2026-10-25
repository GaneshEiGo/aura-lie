// === FILE START ===
// packages/autonomy/test/daily-brief.test.ts
// PRD §10.7 · F-089 · FR-PRO-08.

import { describe, it, expect } from 'vitest';
import {
  composeDailyBrief,
  recordNotUseful,
  computeKindWeights,
  MAX_BRIEF_ITEMS,
  type BriefItem,
  type NotUsefulFeedback,
} from '../src/daily-brief.js';

function item(
  kind: BriefItem['kind'],
  title: string,
  priority: 1 | 2 | 3 = 2,
): BriefItem {
  return { kind, title, one_line: `${title} one-liner`, link: `/x/${title}`, priority };
}

describe('composeDailyBrief', () => {
  it('empty candidates returns an empty brief', () => {
    const brief = composeDailyBrief({ date: '2026-10-02', candidates: [] });
    expect(brief.items).toEqual([]);
    expect(brief.total_considered).toBe(0);
    expect(brief.total_sent).toBe(0);
  });

  it('single candidate survives', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [item('changed', 'PRD updated')],
    });
    expect(brief.items.length).toBe(1);
    expect(brief.items[0]!.title).toBe('PRD updated');
  });

  it('dedupes by (kind, title) — keeps highest priority', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [
        item('changed', 'A', 3),
        item('changed', 'A', 1),
        item('changed', 'A', 2),
      ],
    });
    expect(brief.items.length).toBe(1);
    expect(brief.items[0]!.priority).toBe(1);
  });

  it('enforces kind diversity (one item per kind)', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [
        item('changed', 'A1'),
        item('changed', 'A2'),
        item('open-loop', 'B1'),
        item('open-loop', 'B2'),
      ],
    });
    expect(brief.items.length).toBe(2);
    const kinds = brief.items.map((i) => i.kind);
    expect(kinds).toContain('changed');
    expect(kinds).toContain('open-loop');
  });

  it('caps at MAX_BRIEF_ITEMS = 4', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [
        item('changed', 'A'),
        item('open-loop', 'B'),
        item('important-task', 'C'),
        item('worth-knowing', 'D'),
      ],
    });
    expect(brief.items.length).toBe(4);
    expect(brief.total_sent).toBe(MAX_BRIEF_ITEMS);
  });

  it('sorts output by priority ascending', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [
        item('changed', 'A', 3),
        item('open-loop', 'B', 1),
        item('important-task', 'C', 2),
      ],
    });
    expect(brief.items.map((i) => i.priority)).toEqual([1, 2, 3]);
  });

  it('date field is preserved', () => {
    const brief = composeDailyBrief({ date: '2026-10-02', candidates: [] });
    expect(brief.date).toBe('2026-10-02');
  });

  it('total_considered counts before dedup', () => {
    const brief = composeDailyBrief({
      date: '2026-10-02',
      candidates: [
        item('changed', 'A', 1),
        item('changed', 'A', 1), // dup
        item('changed', 'A', 1), // dup
      ],
    });
    expect(brief.total_considered).toBe(3);
    expect(brief.total_sent).toBe(1);
  });
});

describe('recordNotUseful', () => {
  it('appends feedback and preserves history', () => {
    const a: NotUsefulFeedback = { kind: 'changed', action: 'not-useful', at: '2026-10-02' };
    const b: NotUsefulFeedback = { kind: 'open-loop', action: 'never-about-this', at: '2026-10-02' };
    const out = recordNotUseful([a], b);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});

describe('computeKindWeights', () => {
  it('with no feedback, every kind weighs 1.0', () => {
    const w = computeKindWeights([]);
    expect(w.length).toBe(4);
    for (const k of w) {
      expect(k.weight).toBe(1);
    }
  });

  it('each not-useful drops the weight by 0.1', () => {
    const fb: NotUsefulFeedback[] = [
      { kind: 'changed', action: 'not-useful', at: '2026-10-02' },
      { kind: 'changed', action: 'not-useful', at: '2026-10-02' },
    ];
    const w = computeKindWeights(fb);
    const changed = w.find((k) => k.kind === 'changed')!;
    expect(changed.weight).toBeCloseTo(0.8, 5);
  });

  it('a single never-about-this zeroes the weight', () => {
    const fb: NotUsefulFeedback[] = [
      { kind: 'open-loop', action: 'never-about-this', at: '2026-10-02' },
    ];
    const w = computeKindWeights(fb);
    const openLoop = w.find((k) => k.kind === 'open-loop')!;
    expect(openLoop.weight).toBe(0);
  });

  it('mix: 3 not-useful + never-about-this clamps at 0', () => {
    const fb: NotUsefulFeedback[] = [
      { kind: 'worth-knowing', action: 'not-useful', at: '2026-10-02' },
      { kind: 'worth-knowing', action: 'not-useful', at: '2026-10-02' },
      { kind: 'worth-knowing', action: 'not-useful', at: '2026-10-02' },
      { kind: 'worth-knowing', action: 'never-about-this', at: '2026-10-02' },
    ];
    const w = computeKindWeights(fb);
    const wk = w.find((k) => k.kind === 'worth-knowing')!;
    expect(wk.weight).toBe(0);
  });

  it('other kinds are unaffected by one kind\'s feedback', () => {
    const fb: NotUsefulFeedback[] = [
      { kind: 'changed', action: 'not-useful', at: '2026-10-02' },
    ];
    const w = computeKindWeights(fb);
    const openLoop = w.find((k) => k.kind === 'open-loop')!;
    expect(openLoop.weight).toBe(1);
  });
});
// === FILE END ===