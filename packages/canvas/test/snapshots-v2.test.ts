// === FILE START ===
// packages/canvas/test/snapshots-v2.test.ts
// PRD §9.11 · FR-MEM-12 · F-050 · F-062.
//
// FIX HISTORY (post Section 102):
//   The mixed-diff test asserted unchanged === 4, forgetting that `decisions:
//   'use Cloudflare'` is present in BOTH snapshots and therefore counts as
//   unchanged. The source `diffSnapshots` was correct; the test's arithmetic
//   was wrong. Corrected to 5 and the comment now names the unchanged decision.

import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  diffSnapshots,
  type ProjectState,
} from '../src/snapshots-v2.js';

function baseState(): Omit<ProjectState, 'projectId'> {
  return {
    goals: ['ship v1'],
    tasks: ['write tests', 'fix bug'],
    openLoops: ['verify pricing'],
    decisions: ['use Cloudflare'],
    files: ['spec.md'],
  };
}

describe('snapshots — createSnapshot', () => {
  it('produces a valid snapshot with a captured date', () => {
    const snap = createSnapshot('proj-1', baseState(), '2026-10-02T12:00:00Z');
    expect(snap.projectId).toBe('proj-1');
    expect(snap.capturedAt).toBe('2026-10-02T12:00:00Z');
    expect(snap.state.goals).toEqual(['ship v1']);
  });

  it('does not mutate the caller-supplied state arrays', () => {
    const input = baseState();
    const before = JSON.stringify(input);
    const snap = createSnapshot('proj-1', input, '2026-10-02T12:00:00Z');
    expect(JSON.stringify(input)).toBe(before);
    snap.state.goals.push('extra');
    expect(input.goals).toEqual(['ship v1']);
  });

  it('rejects an empty projectId', () => {
    expect(() => createSnapshot('', baseState(), '2026-10-02T12:00:00Z')).toThrow();
  });
});

describe('snapshots — diffSnapshots basics', () => {
  it('identical states → zero changes and full unchanged count', () => {
    const a = createSnapshot('proj-1', baseState(), '2026-10-01T00:00:00Z');
    const b = createSnapshot('proj-1', baseState(), '2026-10-02T00:00:00Z');
    const d = diffSnapshots(a, b);
    expect(d.meaningfulChanges).toBe(0);
    expect(d.minorChanges).toBe(0);
    // 1 goal + 2 tasks + 1 open loop + 1 decision + 1 file = 6
    expect(d.unchanged).toBe(6);
  });

  it('rejects diffs across different projects', () => {
    const a = createSnapshot('proj-1', baseState(), '2026-10-01T00:00:00Z');
    const b = createSnapshot('proj-2', baseState(), '2026-10-02T00:00:00Z');
    expect(() => diffSnapshots(a, b)).toThrow();
  });
});

describe('snapshots — meaningful changes', () => {
  it('adding a decision is meaningful', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), decisions: ['use Cloudflare', 'use D1'] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.meaningfulChanges).toBe(1);
    expect(d.details.some((x) => x.category === 'decisions' && x.kind === 'added')).toBe(true);
  });

  it('removing a goal is meaningful', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), goals: [] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.meaningfulChanges).toBe(1);
    expect(d.details[0]!.severity).toBe('meaningful');
  });

  it('removing an open loop is meaningful (the loop closed)', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), openLoops: [] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.meaningfulChanges).toBe(1);
    expect(d.details[0]!.category).toBe('openLoops');
  });
});

describe('snapshots — minor changes', () => {
  it('adding a task is minor', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), tasks: ['write tests', 'fix bug', 'refactor'] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.minorChanges).toBe(1);
    expect(d.meaningfulChanges).toBe(0);
  });

  it('adding a file is minor', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), files: ['spec.md', 'readme.md'] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.minorChanges).toBe(1);
  });

  it('adding an open loop is minor', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = { ...baseState(), openLoops: ['verify pricing', 'verify margin'] };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.minorChanges).toBe(1);
    expect(d.meaningfulChanges).toBe(0);
  });
});

describe('snapshots — mixed diff produces the PRD example shape', () => {
  it('reports meaningful, minor, and unchanged counts', () => {
    const a = createSnapshot('p', baseState(), '2026-10-01');
    const stateB = {
      goals: ['ship v1'],                                       // unchanged (1)
      tasks: ['write tests', 'fix bug', 'refactor'],            // 2 unchanged + 1 minor add
      openLoops: [],                                            // 1 meaningful remove
      decisions: ['use Cloudflare', 'use D1'],                  // 1 unchanged + 1 meaningful add
      files: ['spec.md'],                                       // unchanged (1)
    };
    const b = createSnapshot('p', stateB, '2026-10-02');
    const d = diffSnapshots(a, b);
    expect(d.meaningfulChanges).toBe(2); // open-loop remove + decision add
    expect(d.minorChanges).toBe(1);      // task add
    // Unchanged: goal (1) + tasks matching (2) + decision "use Cloudflare" (1) + file (1) = 5
    expect(d.unchanged).toBe(5);
  });
});
// === FILE END ===