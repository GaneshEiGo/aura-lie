// === FILE START ===
// packages/core-mode/test/orchestrator-crisis.test.ts
// Section 70 · FR-SAFE-04 · FR-CORE-02 · crisis path is wired into the
// orchestrator so a crisis query is never queued as a promise.

import { describe, it, expect } from 'vitest';
import { CoreModeOrchestrator } from '../src/orchestrator.js';
import { CrisisGuard } from '../../safety/src/crisis.js';

function fixedClock(at: number): {
  clock: { now(): number };
  advance: (ms: number) => void;
} {
  let t = at;
  return {
    clock: { now: () => t },
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('CoreModeOrchestrator — crisis path wiring', () => {
  it('HIGH-risk query returns a crisis answer', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('I want to kill myself');
    expect(result.type).toBe('crisis');
    expect(typeof result.text).toBe('string');
    expect((result.text as string).toLowerCase()).toContain('not a therapist');
    expect(result.crisis?.risk).toBe('high');
    expect(result.crisis?.resources.length).toBeGreaterThan(0);
  });

  it('MEDIUM-risk query returns a crisis answer', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('I see no point in going on');
    expect(result.type).toBe('crisis');
    expect(result.crisis?.risk).toBe('medium');
  });

  it('crisis query does NOT enqueue a promise', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    orch.answer('I want to kill myself');
    expect(orch.hasPending()).toBe(false);
    expect(orch.stats().total).toBe(0);
  });

  it('crisis response contains at least one crisis resource', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('I want to die');
    expect(result.crisis?.resources.length).toBeGreaterThan(0);
    const hasNumber = result.crisis?.resources.some((r) =>
      /\d/.test(r.number),
    );
    expect(hasNumber).toBe(true);
  });

  it('LOW-risk query follows the normal Section-69 path (cache)', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('What is the capital of France?');
    expect(result.type).toBe('cache');
  });

  it('LOW-risk non-cached query follows the normal Section-69 path (promise)', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(result.type).toBe('promise');
    expect(result.promiseId).toBeTruthy();
    expect(orch.hasPending()).toBe(true);
  });

  it('fiction query does not trigger the crisis path', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer(
      'In my novel, the protagonist wants to die',
    );
    expect(result.type).not.toBe('crisis');
  });

  it('joke / idiom query does not trigger the crisis path', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    const result = orch.answer('This code is killing me lol');
    expect(result.type).not.toBe('crisis');
  });

  it('crisis path records elapsedMs (>= 0)', () => {
    const { clock, advance } = fixedClock(1_000);
    const orch = new CoreModeOrchestrator({
      clock,
      crisisGuard: new CrisisGuard(),
    });
    advance(5);
    const result = orch.answer('I want to kill myself');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('region option is honoured by the crisis response', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
      region: 'US',
    });
    const result = orch.answer('I want to kill myself');
    expect(result.type).toBe('crisis');
    expect((result.text as string)).toContain('988');
  });

  it('region IN produces Tele-MANAS in the message', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
      region: 'IN',
    });
    const result = orch.answer('I want to die');
    expect((result.text as string)).toContain('14416');
  });

  it('crisis path does not disturb banner()', () => {
    const orch = new CoreModeOrchestrator({
      crisisGuard: new CrisisGuard(),
    });
    orch.answer('I want to kill myself');
    const banner = orch.banner('core-mode');
    expect(banner.state).toBe('core-mode');
    expect(banner.message).toContain('Cloud models are resting');
  });
});

describe('CoreModeOrchestrator — without crisis guard (Section 69 parity)', () => {
  it('HIGH-risk text without a guard returns a normal (non-crisis) answer', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('I want to kill myself');
    // Without a guard, this goes through the engine ladder → promise
    expect(result.type).not.toBe('crisis');
  });

  it('cache hit still returns cache type', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('What is the capital of France?');
    expect(result.type).toBe('cache');
  });

  it('math still returns tool type', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('calculate 15 * 3');
    expect(result.type).toBe('tool');
    expect(result.text).toBe('The result is 45.');
  });

  it('unknown query still returns promise type', () => {
    const orch = new CoreModeOrchestrator();
    const result = orch.answer('Write a 5000 word essay on the history of Rome.');
    expect(result.type).toBe('promise');
    expect(orch.hasPending()).toBe(true);
  });

  it('banner() returns the exact PRD copy without needing a guard', () => {
    const orch = new CoreModeOrchestrator();
    expect(orch.banner('core-mode').message).toContain('Cloud models are resting');
    expect(orch.banner('offline').message).toContain('No internet');
    expect(orch.banner('quota-low').message).toContain('nearly used up');
    expect(orch.banner('promise-queued').message).toContain('Queued');
  });

  it('stats() and keepRate() work identically without a guard', () => {
    const orch = new CoreModeOrchestrator();
    expect(orch.stats().total).toBe(0);
    expect(orch.keepRate()).toBe(1);
    const r = orch.answer('Write an essay.');
    orch.resolvePromise(r.promiseId as string, true);
    expect(orch.stats().kept).toBe(1);
    expect(orch.keepRate()).toBe(1);
  });
});
// === FILE END ===