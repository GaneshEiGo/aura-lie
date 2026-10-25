// === FILE START ===
// packages/agents/test/durable-mission-v2.test.ts
// PRD §10.9 · §13.7 · FR-AGENT-02 · F-097.

import { describe, it, expect } from 'vitest';
import {
  createDurableMission,
  applySlice,
  markAttempt,
  setStopped,
  createInMemoryStore,
  saveMission,
  loadMission,
  MAX_SUBREQUESTS_PER_REQUEST,
} from '../src/durable-mission-v2.js';

const T0 = 1_000_000;

function fresh() {
  return createDurableMission('m1', { totalSteps: 5, maxSubrequests: 100 }, T0);
}

describe('durable-mission — creation', () => {
  it('initialises a clean state', () => {
    const m = fresh();
    expect(m.id).toBe('m1');
    expect(m.cursor).toBe(0);
    expect(m.totalSteps).toBe(5);
    expect(m.attempts).toBe(0);
    expect(m.stopped).toBeNull();
    expect(m.lastAppliedToken).toBeNull();
    expect(m.budget.usedSubrequests).toBe(0);
  });

  it('rejects empty id and non-positive config', () => {
    expect(() =>
      createDurableMission('', { totalSteps: 1, maxSubrequests: 1 }, T0),
    ).toThrow();
    expect(() =>
      createDurableMission('m', { totalSteps: 0, maxSubrequests: 1 }, T0),
    ).toThrow();
    expect(() =>
      createDurableMission('m', { totalSteps: 1, maxSubrequests: 0 }, T0),
    ).toThrow();
  });
});

describe('durable-mission — applySlice happy path', () => {
  it('advances cursor by exactly one and records the token', () => {
    const r = applySlice(fresh(), {
      token: 'tok-1',
      subrequests: 5,
      nowMs: T0 + 1000,
    });
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('applied');
    expect(r.state.cursor).toBe(1);
    expect(r.state.lastAppliedToken).toBe('tok-1');
    expect(r.state.budget.usedSubrequests).toBe(5);
  });

  it('appends a slice trace event and advances updatedAtMs', () => {
    const r = applySlice(fresh(), {
      token: 'tok-1',
      subrequests: 3,
      nowMs: T0 + 500,
    });
    expect(r.state.updatedAtMs).toBe(T0 + 500);
    const slices = r.state.trace.filter((e) => e.kind === 'slice');
    expect(slices.length).toBe(1);
    expect(slices[0]!.timestampMs).toBe(T0 + 500);
  });
});

describe('durable-mission — idempotency', () => {
  it('replaying the same token → already-applied with unchanged cursor', () => {
    const r1 = applySlice(fresh(), {
      token: 'tok-1',
      subrequests: 5,
      nowMs: T0 + 1000,
    });
    const r2 = applySlice(r1.state, {
      token: 'tok-1',
      subrequests: 5,
      nowMs: T0 + 2000,
    });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('already-applied');
    expect(r2.state.cursor).toBe(r1.state.cursor);
  });
});

describe('durable-mission — rejections', () => {
  it('rejects subrequests over the per-slice hard cap', () => {
    const r = applySlice(fresh(), {
      token: 'tok-x',
      subrequests: MAX_SUBREQUESTS_PER_REQUEST + 1,
      nowMs: T0 + 1000,
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('subrequest-limit-exceeded');
  });

  it('rejects when the mission has been stopped', () => {
    const stopped = setStopped(fresh(), 'kill-switch', T0 + 100);
    const r = applySlice(stopped, {
      token: 'tok-x',
      subrequests: 5,
      nowMs: T0 + 1000,
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('stopped');
  });

  it('rejects when the subrequest budget would be exceeded', () => {
    const m = createDurableMission('m1', { totalSteps: 5, maxSubrequests: 10 }, T0);
    const r1 = applySlice(m, { token: 'tok-1', subrequests: 8, nowMs: T0 + 100 });
    expect(r1.applied).toBe(true);
    const r2 = applySlice(r1.state, { token: 'tok-2', subrequests: 5, nowMs: T0 + 200 });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('budget-exceeded');
  });

  it('rejects when the cursor has reached totalSteps', () => {
    const m = createDurableMission('m1', { totalSteps: 1, maxSubrequests: 100 }, T0);
    const r1 = applySlice(m, { token: 'tok-1', subrequests: 5, nowMs: T0 + 100 });
    expect(r1.state.cursor).toBe(1);
    const r2 = applySlice(r1.state, { token: 'tok-2', subrequests: 5, nowMs: T0 + 200 });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('budget-exceeded');
  });
});

describe('durable-mission — markAttempt and setStopped', () => {
  it('markAttempt increments attempts and appends a trace event', () => {
    const m = markAttempt(fresh(), T0 + 500);
    expect(m.attempts).toBe(1);
    const attempts = m.trace.filter((e) => e.kind === 'attempt');
    expect(attempts.length).toBe(1);
    expect(m.updatedAtMs).toBe(T0 + 500);
  });

  it('setStopped records the reason and is idempotent', () => {
    const s1 = setStopped(fresh(), 'kill-switch', T0 + 500);
    expect(s1.stopped).toBe('kill-switch');
    const s2 = setStopped(s1, 'different', T0 + 600);
    expect(s2.stopped).toBe('kill-switch');
  });
});

describe('durable-mission — store round-trip', () => {
  it('save → load returns an equal state; unknown id → undefined', () => {
    const store = createInMemoryStore();
    const m = fresh();
    saveMission(store, m);
    const back = loadMission(store, 'm1');
    expect(back).toBeDefined();
    expect(JSON.stringify(back)).toBe(JSON.stringify(m));
    expect(loadMission(store, 'missing')).toBeUndefined();
  });
});

describe('durable-mission — source scan', () => {
  it('source scan: durable-mission-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'durable-mission-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===