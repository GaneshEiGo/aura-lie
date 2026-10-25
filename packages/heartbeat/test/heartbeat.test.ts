// packages/heartbeat/test/heartbeat.test.ts
import { describe, it, expect } from 'vitest';
import {
  shouldCompose,
  computeSendScore,
  computeFatigue,
  isQuietHour,
  rollover,
  startOfLocalDay,
  LEVEL_CAPS,
  LEVEL_THRESHOLDS,
} from '../src/index.js';
import type {
  HeartbeatState,
  RecentNote,
  Trigger,
} from '../src/types.js';

function fixedClock(at: number): {
  clock: { now(): number };
  set: (t: number) => void;
  add: (d: number) => void;
} {
  let current = at;
  return {
    clock: { now: () => current },
    set: (t: number) => {
      current = t;
    },
    add: (d: number) => {
      current += d;
    },
  };
}

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 't1',
    topic: 'verify-claim',
    relevance: 0.9,
    urgency: 0.9,
    novelty: 0.9,
    consent: true,
    interruptibility: 'important',
    reason: 'Your verification finished overnight.',
    ...overrides,
  };
}

function makeState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    level: 2,
    notesToday: 0,
    dayStart: startOfLocalDay(Date.now()),
    recentNotes: [],
    killSwitchActive: false,
    urgentPassesQuietHours: false,
    ...overrides,
  };
}

describe('Heartbeat Engine (PRD 10.4, 10.5, 5.18, F-084)', () => {
  // ---- Fatigue formula ------------------------------------------------
  it('fatigue = max(notes_today/cap, ignored_rate_7d)', () => {
    expect(computeFatigue(0, 4, [])).toBe(0);
    expect(computeFatigue(2, 4, [])).toBe(0.5);
    expect(computeFatigue(4, 4, [])).toBe(1);
    // ignored > capTerm: 3 of 4 recent notes ignored → 0.75
    const recent: RecentNote[] = [
      { topic: 'a', at: 1, ignored: true },
      { topic: 'b', at: 2, ignored: true },
      { topic: 'c', at: 3, ignored: true },
      { topic: 'd', at: 4, ignored: false },
    ];
    expect(computeFatigue(0, 4, recent)).toBe(0.75);
  });

  // ---- Send score formula ---------------------------------------------
  it('send score = R × U × N × (1 − Fa) × K', () => {
    const trigger = makeTrigger({ relevance: 0.9, urgency: 0.8, novelty: 0.7 });
    const state = makeState({ level: 2, notesToday: 0, recentNotes: [] });
    const score = computeSendScore(trigger, state);
    // 0.9 × 0.8 × 0.7 × (1 - 0) × 1 = 0.504
    expect(score.raw).toBeCloseTo(0.504, 6);
    expect(score.threshold).toBeCloseTo(0.45, 6);
    expect(score.passes).toBe(true);
  });

  it('send score is zero when consent = false (K = 0)', () => {
    const trigger = makeTrigger({ consent: false });
    const state = makeState();
    const score = computeSendScore(trigger, state);
    expect(score.raw).toBe(0);
    expect(score.passes).toBe(false);
  });

  // ---- Thresholds per level ------------------------------------------
  it('thresholds match PRD: L1 ≥ 0.55, L2 ≥ 0.45, L3 ≥ 0.40', () => {
    expect(LEVEL_THRESHOLDS[1]).toBe(0.55);
    expect(LEVEL_THRESHOLDS[2]).toBe(0.45);
    expect(LEVEL_THRESHOLDS[3]).toBe(0.4);
  });

  it('compose threshold is level-dependent', () => {
    // score = 0.9 × 0.9 × 0.9 × 1 × 1 = 0.729
    const trigger = makeTrigger();
    const at03 = shouldCompose(trigger, makeState({ level: 3 }), {
      clock: fixedClock(new Date(2026, 9, 20, 12).getTime()).clock,
    });
    expect(at03.compose).toBe(true);

    const weak = makeTrigger({ relevance: 0.4, urgency: 0.6, novelty: 0.5 });
    // 0.4 × 0.6 × 0.5 = 0.12 → below every level.
    const at12 = shouldCompose(weak, makeState({ level: 1 }), {
      clock: fixedClock(new Date(2026, 9, 20, 12).getTime()).clock,
    });
    expect(at12.compose).toBe(false);
    expect(at12.blockedBy).toBe('score');
  });

  // ---- Daily caps ----------------------------------------------------
  it('caps match PRD: L1=2, L2=4, L3=6', () => {
    expect(LEVEL_CAPS[0]).toBe(0);
    expect(LEVEL_CAPS[1]).toBe(2);
    expect(LEVEL_CAPS[2]).toBe(4);
    expect(LEVEL_CAPS[3]).toBe(6);
  });

  it('blocks at the level cap', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const atCap = shouldCompose(
      makeTrigger(),
      makeState({ level: 1, notesToday: 2 }),
      { clock },
    );
    expect(atCap.compose).toBe(false);
    expect(atCap.blockedBy).toBe('cap_reached');
  });

  it('global hard cap of 6 clamps higher levels', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    // Level 3 would allow 6, but the state already has 6 notes today.
    const blocked = shouldCompose(
      makeTrigger(),
      makeState({ level: 3, notesToday: 6 }),
      { clock },
    );
    expect(blocked.compose).toBe(false);
    expect(blocked.blockedBy).toBe('cap_reached');
  });

  // ---- Kill switch ---------------------------------------------------
  it('kill switch blocks composition FIRST', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const decision = shouldCompose(
      makeTrigger(),
      makeState({ killSwitchActive: true }),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('kill_switch');
  });

  // ---- Level 0 silent ------------------------------------------------
  it('level 0 is silent even with a passing score', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const decision = shouldCompose(
      makeTrigger(),
      makeState({ level: 0 }),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('level_silent');
  });

  // ---- Quiet hours ---------------------------------------------------
  it('isQuietHour handles cross-midnight window (23..8)', () => {
    const at = (h: number) => new Date(2026, 9, 20, h, 0).getTime();
    expect(isQuietHour(at(23), 23, 8)).toBe(true);   // 23:00
    expect(isQuietHour(at(0), 23, 8)).toBe(true);    // 00:00
    expect(isQuietHour(at(7), 23, 8)).toBe(true);    // 07:00
    expect(isQuietHour(at(8), 23, 8)).toBe(false);   // 08:00
    expect(isQuietHour(at(12), 23, 8)).toBe(false);  // 12:00
  });

  it('quiet hours block non-urgent triggers', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 23, 30).getTime());
    const decision = shouldCompose(
      makeTrigger({ interruptibility: 'important' }),
      makeState(),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('quiet_hours');
    expect(decision.reason).toMatch(/23:00–08:00/);
  });

  it('URGENT inside quiet hours is still blocked unless user enabled', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 23, 30).getTime());
    const decision = shouldCompose(
      makeTrigger({
        interruptibility: 'urgent',
        deadlineWithinHour: true,
      }),
      makeState({ urgentPassesQuietHours: false }),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('quiet_hours');
  });

  it('URGENT inside quiet hours passes when user enabled + deadline within hour', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 23, 30).getTime());
    const decision = shouldCompose(
      makeTrigger({
        interruptibility: 'urgent',
        deadlineWithinHour: true,
      }),
      makeState({ urgentPassesQuietHours: true }),
      { clock },
    );
    expect(decision.compose).toBe(true);
  });

  // ---- Cooldown ------------------------------------------------------
  it('per-topic cooldown blocks a repeat trigger', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const state = makeState({
      level: 2,
      recentNotes: [
        { topic: 'verify-claim', at: new Date(2026, 9, 20, 6).getTime(), ignored: false },
      ],
    });
    const decision = shouldCompose(makeTrigger(), state, { clock });
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('cooldown');
  });

  it('different topic bypasses the cooldown', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const state = makeState({
      level: 2,
      recentNotes: [
        { topic: 'open-loop-done', at: new Date(2026, 9, 20, 6).getTime(), ignored: false },
      ],
    });
    const decision = shouldCompose(makeTrigger(), state, { clock });
    expect(decision.compose).toBe(true);
  });

  // ---- Daily rollover ------------------------------------------------
  it('notesToday resets at midnight', () => {
    const yesterday = new Date(2026, 9, 19, 22).getTime();
    const today = new Date(2026, 9, 20, 9).getTime();
    const state: HeartbeatState = {
      level: 2,
      notesToday: 4,
      dayStart: startOfLocalDay(yesterday),
      recentNotes: [],
      killSwitchActive: false,
      urgentPassesQuietHours: false,
    };
    const rolled = rollover(state, today);
    expect(rolled.notesToday).toBe(0);
    expect(rolled.dayStart).toBe(startOfLocalDay(today));
  });

  it('recentNotes prunes entries older than 7 days', () => {
    const now = new Date(2026, 9, 20, 12).getTime();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const state = makeState({
      recentNotes: [
        { topic: 'old', at: eightDaysAgo, ignored: true },
        { topic: 'new', at: now - 1000, ignored: false },
      ],
    });
    const rolled = rollover(state, now);
    expect(rolled.recentNotes.length).toBe(1);
    expect(rolled.recentNotes[0].topic).toBe('new');
  });

  // ---- Fatigue feeds into decision -----------------------------------
  it('heavy ignored notes reduce score below threshold', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const now = new Date(2026, 9, 20, 12).getTime();
    const recent: RecentNote[] = Array.from({ length: 6 }, (_, i) => ({
      topic: `t${i}`,
      at: now - (i + 1) * 1000,
      ignored: true,
    }));
    // Fatigue = max(0/4, 6/6) = 1 → (1 - 1) = 0 → score = 0
    const decision = shouldCompose(
      makeTrigger(),
      makeState({ level: 2, recentNotes: recent }),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('score');
    expect(decision.score.fatigue).toBe(1);
  });

  // ---- Zero model calls when blocked ---------------------------------
  it('a blocked decision never implies a compose step', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    // Everything wrong: kill switch + at cap + quiet hours + weak score.
    const decision = shouldCompose(
      makeTrigger({ relevance: 0.1, urgency: 0.1, novelty: 0.1 }),
      makeState({ level: 3, notesToday: 6, killSwitchActive: true }),
      { clock },
    );
    expect(decision.compose).toBe(false);
    expect(decision.blockedBy).toBe('kill_switch');
    // The caller's contract: if compose === false, no provider call.
  });

  // ---- "Why did I get this?" reason ---------------------------------
  it('a passing decision carries the trigger reason', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const decision = shouldCompose(
      makeTrigger({ reason: 'Your verification finished overnight. One claim changed.' }),
      makeState(),
      { clock },
    );
    expect(decision.compose).toBe(true);
    expect(decision.reason).toBe(
      'Your verification finished overnight. One claim changed.',
    );
    expect(decision.score.raw).toBeGreaterThan(0);
  });

  // ---- Score visible even when blocked for other reasons -------------
  it('score is always computed even when another gate blocks first', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const decision = shouldCompose(
      makeTrigger(),
      makeState({ killSwitchActive: true }),
      { clock },
    );
    expect(decision.score.raw).toBeGreaterThan(0);
    expect(decision.score.passes).toBe(true);
    expect(decision.blockedBy).toBe('kill_switch');
  });

  // ---- Deadline-urgent helper ----------------------------------------
  it('URGENT outside quiet hours passes without needing the enable flag', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const decision = shouldCompose(
      makeTrigger({ interruptibility: 'urgent', deadlineWithinHour: true }),
      makeState({ urgentPassesQuietHours: false }),
      { clock },
    );
    expect(decision.compose).toBe(true);
  });
});