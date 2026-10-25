// === FILE START ===
// packages/agents/test/queue-resume-v2.test.ts
// PRD §10.4 · §13.7 · F-084 · FR-AGENT-02.

import { describe, it, expect } from 'vitest';
import {
  makeResumeMessage,
  isExpired,
  nextBackoffMs,
  decideTick,
  followUpMessage,
  MAX_ATTEMPTS,
  MESSAGE_TTL_MS,
  type ResumeMessage,
} from '../src/queue-resume-v2.js';
import { createDurableMission } from '../src/durable-mission-v2.js';

const T0 = 1_000_000;

function freshMission() {
  return createDurableMission('m1', { totalSteps: 5, maxSubrequests: 100 }, T0);
}

describe('queue-resume — makeResumeMessage', () => {
  it('populates every field correctly with default attemptNumber and delay', () => {
    const msg = makeResumeMessage('m1', 'tok-1', T0);
    expect(msg.kind).toBe('resume-mission');
    expect(msg.missionId).toBe('m1');
    expect(msg.token).toBe('tok-1');
    expect(msg.attemptNumber).toBe(1);
    expect(msg.enqueuedAtMs).toBe(T0);
    expect(msg.visibleAtMs).toBe(T0);
  });

  it('validates its inputs', () => {
    expect(() => makeResumeMessage('', 'tok-1', T0)).toThrow();
    expect(() => makeResumeMessage('m1', '', T0)).toThrow();
    expect(() => makeResumeMessage('m1', 'tok-1', T0, 0)).toThrow();
    expect(() => makeResumeMessage('m1', 'tok-1', T0, -1)).toThrow();
  });

  it('a positive delayMs pushes visibleAtMs into the future', () => {
    const msg = makeResumeMessage('m1', 'tok-1', T0, 1, 30_000);
    expect(msg.visibleAtMs).toBe(T0 + 30_000);
    expect(msg.enqueuedAtMs).toBe(T0);
  });
});

describe('queue-resume — expiry', () => {
  it('isExpired is false within TTL and true past TTL', () => {
    const msg = makeResumeMessage('m1', 'tok-1', T0);
    expect(isExpired(msg, T0 + 100)).toBe(false);
    expect(isExpired(msg, T0 + MESSAGE_TTL_MS + 1)).toBe(true);
  });
});

describe('queue-resume — backoff', () => {
  it('nextBackoffMs doubles the gap by a factor of 3', () => {
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(90_000);
    expect(nextBackoffMs(3)).toBe(270_000);
  });

  it('nextBackoffMs caps at 15 minutes', () => {
    expect(nextBackoffMs(10)).toBe(15 * 60_000);
  });
});

describe('queue-resume — decideTick happy path', () => {
  it('runs when the message is fresh, mission is active, and it is visible', () => {
    const state = freshMission();
    const msg = makeResumeMessage('m1', 'tok-1', T0);
    const d = decideTick({ state, msg, nowMs: T0 + 100, killSwitch: false });
    expect(d.kind).toBe('run');
    if (d.kind !== 'run') return;
    expect(d.token).toBe('tok-1');
  });
});

describe('queue-resume — decideTick wait path', () => {
  it('waits when the message is scheduled for the future', () => {
    const state = freshMission();
    const msg = makeResumeMessage('m1', 'tok-1', T0, 2, 60_000);
    const d = decideTick({ state, msg, nowMs: T0 + 1000, killSwitch: false });
    expect(d.kind).toBe('wait');
    if (d.kind !== 'wait') return;
    expect(d.untilMs).toBe(T0 + 60_000);
  });
});

describe('queue-resume — decideTick drop paths', () => {
  it('drops on kill-switch, stopped, exhausted, or wrong mission', () => {
    const fresh = freshMission();
    const msgFresh = makeResumeMessage('m1', 'tok-1', T0);

    const kill = decideTick({ state: fresh, msg: msgFresh, nowMs: T0, killSwitch: true });
    expect(kill.kind).toBe('drop');
    if (kill.kind === 'drop') expect(kill.reason).toBe('kill-switch');

    const stopped = { ...fresh, stopped: 'kill-switch' };
    const sDrop = decideTick({ state: stopped, msg: msgFresh, nowMs: T0, killSwitch: false });
    expect(sDrop.kind).toBe('drop');
    if (sDrop.kind === 'drop') expect(sDrop.reason).toBe('stopped');

    const exhausted = { ...fresh, cursor: fresh.totalSteps };
    const eDrop = decideTick({ state: exhausted, msg: msgFresh, nowMs: T0, killSwitch: false });
    expect(eDrop.kind).toBe('drop');
    if (eDrop.kind === 'drop') expect(eDrop.reason).toBe('exhausted');

    const wrongMsg = makeResumeMessage('other-id', 'tok-1', T0);
    const wDrop = decideTick({ state: fresh, msg: wrongMsg, nowMs: T0, killSwitch: false });
    expect(wDrop.kind).toBe('drop');
    if (wDrop.kind === 'drop') expect(wDrop.reason).toBe('wrong-mission');
  });

  it('drops on expired message or exceeded attempts', () => {
    const fresh = freshMission();

    const oldMsg = makeResumeMessage('m1', 'tok-1', T0);
    const exp = decideTick({
      state: fresh,
      msg: oldMsg,
      nowMs: T0 + MESSAGE_TTL_MS + 1,
      killSwitch: false,
    });
    expect(exp.kind).toBe('drop');
    if (exp.kind === 'drop') expect(exp.reason).toBe('expired');

    const overMsg: ResumeMessage = makeResumeMessage('m1', 'tok-1', T0, MAX_ATTEMPTS + 1, 0);
    const over = decideTick({ state: fresh, msg: overMsg, nowMs: T0, killSwitch: false });
    expect(over.kind).toBe('drop');
    if (over.kind === 'drop') expect(over.reason).toBe('attempts-exceeded');
  });
});

describe('queue-resume — followUpMessage', () => {
  it('returns null on success or when attempts are exhausted', () => {
    const msg = makeResumeMessage('m1', 'tok-1', T0);
    expect(followUpMessage(msg, T0 + 100, true)).toBeNull();

    const exhausted: ResumeMessage = makeResumeMessage('m1', 'tok-1', T0, MAX_ATTEMPTS, 0);
    expect(followUpMessage(exhausted, T0 + 100, false)).toBeNull();
  });

  it('returns a new message with incremented attempt and future visibleAtMs on failure', () => {
    const msg = makeResumeMessage('m1', 'tok-1', T0);
    const follow = followUpMessage(msg, T0 + 100, false);
    expect(follow).not.toBeNull();
    expect(follow!.missionId).toBe('m1');
    expect(follow!.attemptNumber).toBe(2);
    expect(follow!.visibleAtMs).toBeGreaterThan(T0 + 100);
    expect(follow!.token).not.toBe(msg.token);
  });
});

describe('queue-resume — source scan', () => {
  it('source scan: queue-resume-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'queue-resume-v2.ts'),
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
    const external = specifiers.filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });
});
// === FILE END ===