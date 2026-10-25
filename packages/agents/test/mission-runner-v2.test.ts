// === FILE START ===
// packages/agents/test/mission-runner-v2.test.ts
// PRD §10.9 · FR-AGENT-02 · FR-AGENT-03 · F-097 · F-100.

import { describe, it, expect } from 'vitest';
import {
  createMission,
  stepMission,
  requestStop,
  evaluateStopConditions,
  NO_PROGRESS_LIMIT,
  type MissionConfig,
  type StepOutcome,
} from '../src/mission-runner-v2.js';

const config: MissionConfig = { maxIterations: 5 };
const T0 = 1_000_000;

function cb(overrides: Partial<{ kill: boolean; now: number }> = {}) {
  return {
    killSwitchActive: () => overrides.kill ?? false,
    nowMs: () => overrides.now ?? T0,
  };
}

describe('mission-runner — createMission', () => {
  it('initialises a clean state', () => {
    const m = createMission('m1', config, T0);
    expect(m.id).toBe('m1');
    expect(m.iterations).toBe(0);
    expect(m.stopped).toBeNull();
  });

  it('rejects empty id', () => {
    expect(() => createMission('', config, T0)).toThrow();
  });

  it('rejects non-positive maxIterations', () => {
    expect(() => createMission('m1', { maxIterations: 0 }, T0)).toThrow();
  });
});

describe('mission-runner — single-step stop conditions', () => {
  it('goal-achieved stops immediately', async () => {
    const m = createMission('m1', config, T0);
    const r = await stepMission(m, config, () => ({ madeProgress: true, goalAchieved: true }), cb());
    expect(r.stopped).toBe('goal-achieved');
  });

  it('evidence-sufficient stops immediately', async () => {
    const m = createMission('m1', config, T0);
    const r = await stepMission(m, config, () => ({ madeProgress: true, evidenceSufficient: true }), cb());
    expect(r.stopped).toBe('evidence-sufficient');
  });

  it('unresolved contradiction stops immediately', async () => {
    const m = createMission('m1', config, T0);
    const r = await stepMission(
      m, config, () => ({ madeProgress: true, unresolvedContradiction: true }), cb(),
    );
    expect(r.stopped).toBe('contradiction-unresolved');
  });

  it('requiresPermission stops immediately', async () => {
    const m = createMission('m1', config, T0);
    const r = await stepMission(
      m, config, () => ({ madeProgress: true, requiresPermission: true }), cb(),
    );
    expect(r.stopped).toBe('permission-required');
  });

  it('kill switch stops immediately', async () => {
    const m = createMission('m1', config, T0);
    const r = await stepMission(
      m, config, () => ({ madeProgress: true }), cb({ kill: true }),
    );
    expect(r.stopped).toBe('kill-switch');
  });
});

describe('mission-runner — cumulative stop conditions', () => {
  it('iteration-limit stops after maxIterations', async () => {
    let m = createMission('m1', { maxIterations: 2 }, T0);
    let stopped = null;
    for (let i = 0; i < 3; i++) {
      const r = await stepMission(m, { maxIterations: 2 }, () => ({ madeProgress: true }), cb());
      m = r.state;
      stopped = r.stopped;
    }
    expect(stopped).toBe('iteration-limit');
  });

  it('time-limit stops once maxWallClockMs elapsed', async () => {
    const m = createMission('m1', { maxIterations: 10, maxWallClockMs: 500 }, T0);
    const r = await stepMission(
      m, { maxIterations: 10, maxWallClockMs: 500 },
      () => ({ madeProgress: true }),
      cb({ now: T0 + 1000 }),
    );
    expect(r.stopped).toBe('time-limit');
  });

  it('no-useful-progress stops after NO_PROGRESS_LIMIT consecutive stalls', async () => {
    let m = createMission('m1', { maxIterations: 10 }, T0);
    let stopped = null;
    for (let i = 0; i < NO_PROGRESS_LIMIT + 1; i++) {
      const r = await stepMission(
        m, { maxIterations: 10 }, () => ({ madeProgress: false }), cb(),
      );
      m = r.state;
      stopped = r.stopped;
    }
    expect(stopped).toBe('no-useful-progress');
  });

  it('progress resets the consecutive-no-progress counter', async () => {
    let m = createMission('m1', { maxIterations: 10 }, T0);
    m = (await stepMission(m, { maxIterations: 10 }, () => ({ madeProgress: false }), cb())).state;
    expect(m.consecutiveNoProgress).toBe(1);
    m = (await stepMission(m, { maxIterations: 10 }, () => ({ madeProgress: true }), cb())).state;
    expect(m.consecutiveNoProgress).toBe(0);
  });
});

describe('mission-runner — priority ordering', () => {
  it('kill-switch beats goal-achieved', () => {
    const stop = evaluateStopConditions({
      state: createMission('m1', config, T0),
      outcome: { madeProgress: true, goalAchieved: true },
      config,
      nowMs: T0,
      killSwitchActive: true,
    });
    expect(stop).toBe('kill-switch');
  });

  it('permission-required beats goal-achieved', () => {
    const stop = evaluateStopConditions({
      state: createMission('m1', config, T0),
      outcome: { madeProgress: true, goalAchieved: true, requiresPermission: true },
      config,
      nowMs: T0,
      killSwitchActive: false,
    });
    expect(stop).toBe('permission-required');
  });
});

describe('mission-runner — requestStop and idempotence', () => {
  it('requestStop marks the mission stopped', () => {
    const m = requestStop(createMission('m1', config, T0), 'iteration-limit');
    expect(m.stopped).toBe('iteration-limit');
  });

  it('a stopped mission stays stopped on further steps', async () => {
    const m = requestStop(createMission('m1', config, T0), 'iteration-limit');
    const r = await stepMission(m, config, () => ({ madeProgress: true }), cb());
    expect(r.stopped).toBe('iteration-limit');
    expect(r.state.iterations).toBe(0);
  });
});

describe('mission-runner — determinism', () => {
  it('same inputs produce identical final state', async () => {
    const a0 = createMission('m1', config, T0);
    const a1 = await stepMission(a0, config, () => ({ madeProgress: true }), cb());
    const b0 = createMission('m1', config, T0);
    const b1 = await stepMission(b0, config, () => ({ madeProgress: true }), cb());
    expect(JSON.stringify(a1)).toBe(JSON.stringify(b1));
  });
});
// === FILE END ===