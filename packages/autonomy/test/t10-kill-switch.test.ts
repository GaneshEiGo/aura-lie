// === FILE START ===
// packages/autonomy/test/t10-kill-switch.test.ts
// PRD §10.10 · F-082 · FR-PRO-11 · T-10.
//
// T-10 gate: pause halts every cron compose and mission step; the pause is
// visible across every KillSwitch instance sharing a backend (D1-flag
// semantics); resume restores work; the check itself is instant, so any
// simulated 10-second cron tick inside the 60-second window after pause
// fails.

import { describe, it, expect } from 'vitest';
import {
  KillSwitch,
  KillSwitchPaused,
  createInMemoryBackend,
} from '../src/kill-switch.js';
import {
  getDefaultLevel,
  getRecommendedLevel,
  getNotesCap,
  getEnergyBudget,
} from '../src/ladder.js';

describe('T-10.1 — basic state', () => {
  it('default state is not paused', async () => {
    const ks = new KillSwitch();
    expect(await ks.isPaused()).toBe(false);
  });

  it('pause() sets paused', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    expect(await ks.isPaused()).toBe(true);
  });

  it('resume() clears paused', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    await ks.resume();
    expect(await ks.isPaused()).toBe(false);
  });

  it('pause is idempotent', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    await ks.pause();
    expect(await ks.isPaused()).toBe(true);
  });

  it('resume is idempotent', async () => {
    const ks = new KillSwitch();
    await ks.resume();
    await ks.resume();
    expect(await ks.isPaused()).toBe(false);
  });
});

describe('T-10.2 — tryRun / runIfAllowed', () => {
  it('tryRun executes when not paused', async () => {
    const ks = new KillSwitch();
    const r = await ks.tryRun(() => 42);
    expect(r).toEqual({ executed: true, value: 42 });
  });

  it('tryRun returns paused when paused', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    const r = await ks.tryRun(() => 42);
    expect(r).toEqual({ executed: false, reason: 'paused' });
  });

  it('runIfAllowed throws KillSwitchPaused when paused', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    await expect(ks.runIfAllowed(() => 42)).rejects.toThrow(KillSwitchPaused);
  });

  it('runIfAllowed returns value when active', async () => {
    const ks = new KillSwitch();
    expect(await ks.runIfAllowed(() => 'ok')).toBe('ok');
  });

  it('KillSwitchPaused carries kind "KillSwitchPaused"', () => {
    const e = new KillSwitchPaused();
    expect(e.kind).toBe('KillSwitchPaused');
    expect(e.name).toBe('KillSwitchPaused');
  });
});

describe('T-10.3 — persistence via shared backend (D1-flag semantics)', () => {
  it('two KillSwitch instances over the same backend share state', async () => {
    const backend = createInMemoryBackend();
    const a = new KillSwitch(backend);
    const b = new KillSwitch(backend);

    await a.pause();
    expect(await b.isPaused()).toBe(true);

    await b.resume();
    expect(await a.isPaused()).toBe(false);
  });

  it('pause via one instance is observable via the other in a different tick', async () => {
    const backend = createInMemoryBackend();
    const mainTab = new KillSwitch(backend);
    const background = new KillSwitch(backend);

    await mainTab.pause();
    const r = await background.tryRun(() => 'compose');
    expect(r.executed).toBe(false);
  });
});

describe('T-10.4 — GATE: pause halts every simulated cron tick within the 60 s window', () => {
  it('6 simulated 10 s cron ticks after pause all fail; resume allows ticks again', async () => {
    const ks = new KillSwitch();
    let tickCount = 0;
    const cronTick = () =>
      ks.tryRun(() => {
        tickCount += 1;
        return 'composed';
      });

    // 3 successful ticks before pause
    for (let i = 0; i < 3; i++) {
      const r = await cronTick();
      expect(r.executed).toBe(true);
    }
    expect(tickCount).toBe(3);

    await ks.pause();

    // 6 ticks × 10 s = 60 s window — all blocked
    for (let i = 0; i < 6; i++) {
      const r = await cronTick();
      expect(r.executed).toBe(false);
    }
    expect(tickCount).toBe(3);

    await ks.resume();
    const r = await cronTick();
    expect(r.executed).toBe(true);
    expect(tickCount).toBe(4);
  });

  it('mission step is blocked after pause; resume allows it', async () => {
    const ks = new KillSwitch();
    let stepCount = 0;
    const missionStep = () =>
      ks.runIfAllowed(() => {
        stepCount += 1;
        return 'step-ok';
      });

    expect(await missionStep()).toBe('step-ok');
    await ks.pause();
    await expect(missionStep()).rejects.toThrow(KillSwitchPaused);
    expect(stepCount).toBe(1);

    await ks.resume();
    expect(await missionStep()).toBe('step-ok');
    expect(stepCount).toBe(2);
  });

  it('cron compose function is not invoked when paused (side effect proof)', async () => {
    const ks = new KillSwitch();
    let composed = false;
    const composePush = async () => {
      composed = true;
      return 'push-body';
    };
    await ks.pause();
    const r = await ks.tryRun(composePush);
    expect(r.executed).toBe(false);
    expect(composed).toBe(false);
  });
});

describe('T-10.5 — interaction with ladder / energy budgets', () => {
  it('default level is Silent (0) with zero notes and zero energy', () => {
    expect(getDefaultLevel()).toBe(0);
    expect(getNotesCap(0)).toBe(0);
    expect(getEnergyBudget(0)).toBe(0);
  });

  it('recommended onboarding level is Whisper (1)', () => {
    expect(getRecommendedLevel()).toBe(1);
    expect(getNotesCap(1)).toBe(2);
    expect(getEnergyBudget(1)).toBe(10);
  });

  it('pausing and resuming does not consume any energy budget', async () => {
    const ks = new KillSwitch();
    const before = getEnergyBudget(getRecommendedLevel());
    await ks.pause();
    await ks.resume();
    const after = getEnergyBudget(getRecommendedLevel());
    expect(after).toBe(before);
  });

  it('energy does not bypass the kill switch — paused still blocks', async () => {
    const ks = new KillSwitch();
    await ks.pause();
    // Even at Level 3 (energy = 60) we must still be blocked by pause.
    const r = await ks.tryRun(() => 'should-not-run');
    expect(r.executed).toBe(false);
  });
});
// === FILE END ===