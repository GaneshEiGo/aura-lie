// === FILE START ===
// packages/autonomy/test/open-loops.test.ts
// PRD §10.7 · F-088.

import { describe, it, expect } from 'vitest';
import {
  createOpenLoop,
  closeOpenLoop,
  markSurfaced,
  abandonStaleOpenLoops,
  shouldSurfaceOpenLoop,
  listOpen,
  AUTO_ABANDON_DAYS,
  type OpenLoop,
} from '../src/open-loops.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowAt = (offsetMs: number) => () => T0 + offsetMs;

function fixedId(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe('createOpenLoop', () => {
  it('creates an open loop with defaults', () => {
    const loop = createOpenLoop({
      title: 'Verify the number',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(loop.status).toBe('open');
    expect(loop.source).toBe('user');
    expect(loop.priority).toBe(2);
    expect(loop.surface_count).toBe(0);
    expect(loop.last_surfaced_at).toBeNull();
    expect(loop.due_at).toBeNull();
    expect(loop.closed_at).toBeNull();
    expect(loop.close_reason).toBeNull();
    expect(loop.created_at).toBe(new Date(T0).toISOString());
  });

  it('accepts summary, source, project_id, priority', () => {
    const loop = createOpenLoop({
      title: 'Draft PRD',
      summary: 'Section 10 only',
      source: 'aura-lie',
      project_id: 'p1',
      priority: 1,
      due_at: '2026-10-05T00:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    expect(loop.summary).toBe('Section 10 only');
    expect(loop.source).toBe('aura-lie');
    expect(loop.project_id).toBe('p1');
    expect(loop.priority).toBe(1);
    expect(loop.due_at).toBe('2026-10-05T00:00:00Z');
  });
});

describe('closeOpenLoop', () => {
  it('closes a loop with reason done', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const closed = closeOpenLoop(loop, 'done', { now: nowAt(1000) });
    expect(closed.status).toBe('closed');
    expect(closed.close_reason).toBe('done');
    expect(closed.closed_at).toBe(new Date(T0 + 1000).toISOString());
  });

  it('closes a loop with reason not-useful', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const closed = closeOpenLoop(loop, 'not-useful', { now: nowAt(1000) });
    expect(closed.status).toBe('closed');
    expect(closed.close_reason).toBe('not-useful');
  });

  it('closing with reason abandoned sets status=abandoned', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const closed = closeOpenLoop(loop, 'abandoned', { now: nowAt(1000) });
    expect(closed.status).toBe('abandoned');
    expect(closed.close_reason).toBe('abandoned');
  });

  it('closing an already-closed loop throws', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const closed = closeOpenLoop(loop, 'done', { now: nowAt(1000) });
    expect(() => closeOpenLoop(closed, 'not-useful')).toThrow();
  });
});

describe('markSurfaced', () => {
  it('stamps last_surfaced_at and increments count', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const s1 = markSurfaced(loop, { now: nowAt(1000) });
    expect(s1.last_surfaced_at).toBe(new Date(T0 + 1000).toISOString());
    expect(s1.surface_count).toBe(1);
    const s2 = markSurfaced(s1, { now: nowAt(2000) });
    expect(s2.surface_count).toBe(2);
  });
});

describe('abandonStaleOpenLoops', () => {
  it('leaves young loops alone', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const out = abandonStaleOpenLoops([loop], { now: nowAt(1000 * 60 * 60 * 24) });
    expect(out[0]!.status).toBe('open');
  });

  it('auto-abandons loops older than 60 days', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const day61 = 61 * 24 * 60 * 60 * 1000;
    const out = abandonStaleOpenLoops([loop], { now: nowAt(day61) });
    expect(out[0]!.status).toBe('abandoned');
    expect(out[0]!.close_reason).toBe('abandoned');
  });

  it('does not touch already-closed loops', () => {
    const loop = closeOpenLoop(
      createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() }),
      'done',
      { now: nowAt(0) },
    );
    const day61 = 61 * 24 * 60 * 60 * 1000;
    const out = abandonStaleOpenLoops([loop], { now: nowAt(day61) });
    expect(out[0]!.status).toBe('closed');
  });
});

describe('shouldSurfaceOpenLoop', () => {
  it('refuses to surface at autonomy level 0', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const d = shouldSurfaceOpenLoop(
      loop,
      { autonomyLevel: 0, notesSentToday: 0, notesCap: 2, localHour: 14 },
      { now: nowAt(1000) },
    );
    expect(d.surface).toBe(false);
    expect(d.reason).toBe('level-0');
  });

  it('refuses during quiet hours', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const d = shouldSurfaceOpenLoop(
      loop,
      { autonomyLevel: 1, notesSentToday: 0, notesCap: 2, localHour: 23 },
      { now: nowAt(1000) },
    );
    expect(d.surface).toBe(false);
    expect(d.reason).toBe('quiet-hours');
  });

  it('refuses at the cap', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const d = shouldSurfaceOpenLoop(
      loop,
      { autonomyLevel: 1, notesSentToday: 2, notesCap: 2, localHour: 14 },
      { now: nowAt(1000) },
    );
    expect(d.surface).toBe(false);
    expect(d.reason).toBe('cap-reached');
  });

  it('refuses when recently surfaced', () => {
    const loop = markSurfaced(
      createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() }),
      { now: nowAt(0) },
    );
    const d = shouldSurfaceOpenLoop(
      loop,
      { autonomyLevel: 1, notesSentToday: 0, notesCap: 2, localHour: 14 },
      { now: nowAt(1000 * 60 * 60) }, // 1 hour later
    );
    expect(d.surface).toBe(false);
    expect(d.reason).toBe('recently-surfaced');
  });

  it('surfaces when all conditions pass', () => {
    const loop = createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() });
    const d = shouldSurfaceOpenLoop(
      loop,
      { autonomyLevel: 1, notesSentToday: 0, notesCap: 2, localHour: 14 },
      { now: nowAt(1000) },
    );
    expect(d.surface).toBe(true);
    expect(d.reason).toBe('ok');
  });
});

describe('listOpen', () => {
  it('filters out closed and abandoned loops', () => {
    const open = createOpenLoop({ title: 'a', now: nowAt(0), idFactory: fixedId() });
    const closed = closeOpenLoop(
      createOpenLoop({ title: 'b', now: nowAt(0), idFactory: fixedId() }),
      'done',
      { now: nowAt(0) },
    );
    const list = listOpen([open, closed]);
    expect(list.length).toBe(1);
    expect(list[0]!.title).toBe('a');
  });

  it('sorts by priority (1=highest) first', () => {
    const p3 = createOpenLoop({ title: 'p3', priority: 3, now: nowAt(0), idFactory: fixedId() });
    const p1 = createOpenLoop({ title: 'p1', priority: 1, now: nowAt(0), idFactory: fixedId() });
    const p2 = createOpenLoop({ title: 'p2', priority: 2, now: nowAt(0), idFactory: fixedId() });
    const titles = listOpen([p3, p2, p1]).map((l) => l.title);
    expect(titles).toEqual(['p1', 'p2', 'p3']);
  });

  it('within same priority, sorts by due date first (nulls last)', () => {
    const noDue = createOpenLoop({ title: 'no-due', now: nowAt(0), idFactory: fixedId() });
    const dueLater = createOpenLoop({
      title: 'due-later',
      due_at: '2026-10-10T00:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const dueSooner = createOpenLoop({
      title: 'due-sooner',
      due_at: '2026-10-03T00:00:00Z',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const titles = listOpen([noDue, dueLater, dueSooner]).map((l) => l.title);
    expect(titles).toEqual(['due-sooner', 'due-later', 'no-due']);
  });

  it('AUTO_ABANDON_DAYS is 60', () => {
    expect(AUTO_ABANDON_DAYS).toBe(60);
  });

  it('returns an empty array for all-closed input', () => {
    const closed = closeOpenLoop(
      createOpenLoop({ title: 'x', now: nowAt(0), idFactory: fixedId() }),
      'done',
      { now: nowAt(0) },
    );
    expect(listOpen([closed])).toEqual([]);
  });

  it('preserves loop identity through create → close → list round-trip', () => {
    const loop: OpenLoop = createOpenLoop({
      title: 'x',
      now: nowAt(0),
      idFactory: fixedId(),
    });
    const closed = closeOpenLoop(loop, 'done', { now: nowAt(1000) });
    expect(closed.id).toBe(loop.id);
    expect(listOpen([closed]).length).toBe(0);
  });
});
// === FILE END ===