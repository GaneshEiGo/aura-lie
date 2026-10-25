// === FILE START ===
// packages/proactive/test/heartbeat-v2.test.ts
// PRD 10.5 · FR-PRO-01 to FR-PRO-12.
//
// One test per signal factor in the send-score formula, plus every gate,
// plus threshold boundaries for each level, plus composer validation.

import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_CAPS,
  LEVEL_THRESHOLDS,
  HARD_DAILY_CAP,
  URGENT_THRESHOLD,
  DEFAULT_QUIET_START,
  DEFAULT_QUIET_END,
  DEFAULT_TOPIC_COOLDOWN_MS,
  isInQuietHours,
  decideHeartbeat,
  type HeartbeatState,
  type Signal,
  type TriggerType,
} from '../src/heartbeat-v2.js';
import {
  composeProactiveNote,
  MAX_WORDS,
  DEFAULT_ACTIONS,
} from '../src/composer-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function consentAll(): Record<TriggerType, boolean> {
  return {
    reminder: true,
    deadline: true,
    open_loop: true,
    project_change: true,
    promise_completed: true,
    watched_source: true,
    follow_up: true,
  };
}

function baseState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    level: 3,
    nowMs: T0,
    localHour: 12,
    notesToday: 0,
    ignoreRate7d: 0,
    lastNoteOnTopicMs: new Map(),
    consentByTrigger: consentAll(),
    ...overrides,
  };
}

function baseSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    triggerType: 'reminder',
    topicId: 'topic-1',
    relevance: 1,
    urgency: 1,
    novelty: 1,
    ...overrides,
  };
}

// =============================================================================
// Constants
// =============================================================================

describe('constants (PRD 10.2 · 10.5)', () => {
  it('caps 0/2/4/6 by level', () => {
    expect(AUTONOMY_CAPS[0]).toBe(0);
    expect(AUTONOMY_CAPS[1]).toBe(2);
    expect(AUTONOMY_CAPS[2]).toBe(4);
    expect(AUTONOMY_CAPS[3]).toBe(6);
  });

  it('hard daily cap = 6', () => {
    expect(HARD_DAILY_CAP).toBe(6);
    for (const l of [0, 1, 2, 3] as const) {
      expect(AUTONOMY_CAPS[l]).toBeLessThanOrEqual(HARD_DAILY_CAP);
    }
  });

  it('thresholds 0.55 / 0.45 / 0.40', () => {
    expect(LEVEL_THRESHOLDS[1]).toBe(0.55);
    expect(LEVEL_THRESHOLDS[2]).toBe(0.45);
    expect(LEVEL_THRESHOLDS[3]).toBe(0.40);
  });

  it('default quiet hours 23-8', () => {
    expect(DEFAULT_QUIET_START).toBe(23);
    expect(DEFAULT_QUIET_END).toBe(8);
  });

  it('default cooldown = 24h', () => {
    expect(DEFAULT_TOPIC_COOLDOWN_MS).toBe(24 * HOUR_MS);
  });

  it('urgent threshold = 0.9', () => {
    expect(URGENT_THRESHOLD).toBe(0.9);
  });
});

// =============================================================================
// isInQuietHours
// =============================================================================

describe('isInQuietHours', () => {
  it('23-8 wraps midnight: hour 23 quiet', () => {
    expect(isInQuietHours(23, 23, 8)).toBe(true);
  });
  it('23-8 wraps midnight: hour 0 quiet', () => {
    expect(isInQuietHours(0, 23, 8)).toBe(true);
  });
  it('23-8 wraps midnight: hour 7 quiet', () => {
    expect(isInQuietHours(7, 23, 8)).toBe(true);
  });
  it('23-8 wraps midnight: hour 8 NOT quiet', () => {
    expect(isInQuietHours(8, 23, 8)).toBe(false);
  });
  it('23-8 wraps midnight: hour 22 NOT quiet', () => {
    expect(isInQuietHours(22, 23, 8)).toBe(false);
  });
  it('start === end → never quiet', () => {
    expect(isInQuietHours(12, 0, 0)).toBe(false);
  });
});

// =============================================================================
// Level 0 — silent
// =============================================================================

describe('decideHeartbeat — level 0 (silent)', () => {
  it('always blocks', () => {
    const state = baseState({ level: 0 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('level 0');
  });
});

// =============================================================================
// Consent gate
// =============================================================================

describe('decideHeartbeat — consent gate (PRD 10.5 K factor)', () => {
  it('consent=false for this trigger → block', () => {
    const state = baseState();
    state.consentByTrigger.reminder = false;
    const decision = decideHeartbeat(
      baseSignal({ triggerType: 'reminder' }),
      state,
    );
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('consent');
  });

  it('consent=true for a different trigger → pass', () => {
    const state = baseState();
    state.consentByTrigger.reminder = false;
    const decision = decideHeartbeat(
      baseSignal({ triggerType: 'deadline' }),
      state,
    );
    expect(decision.send).toBe(true);
  });
});

// =============================================================================
// Quiet hours
// =============================================================================

describe('decideHeartbeat — quiet hours', () => {
  it('inside quiet hours → block', () => {
    const state = baseState({ localHour: 23 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('quiet hours');
  });

  it('outside quiet hours → pass', () => {
    const state = baseState({ localHour: 12 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(true);
  });

  it('urgent inside quiet hours → blocked by default', () => {
    const state = baseState({ localHour: 0 });
    const decision = decideHeartbeat(
      baseSignal({ urgency: 1.0 }),
      state,
    );
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('quiet hours');
  });

  it('urgent inside quiet hours with urgentPassesQuietHours=true → pass', () => {
    const state = baseState({ localHour: 0 });
    const decision = decideHeartbeat(
      baseSignal({ urgency: 1.0 }),
      state,
      { urgentPassesQuietHours: true },
    );
    expect(decision.send).toBe(true);
  });

  it('non-urgent inside quiet hours even with urgentPassesQuietHours → block', () => {
    const state = baseState({ localHour: 0 });
    const decision = decideHeartbeat(
      baseSignal({ urgency: 0.5 }),
      state,
      { urgentPassesQuietHours: true },
    );
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('quiet hours');
  });
});

// =============================================================================
// Daily cap
// =============================================================================

describe('decideHeartbeat — daily cap', () => {
  it('level 1: notesToday=2 → block', () => {
    const state = baseState({ level: 1, notesToday: 2 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('daily cap');
  });

  it('level 2: notesToday=4 → block', () => {
    const state = baseState({ level: 2, notesToday: 4 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('daily cap');
  });

  it('level 3: notesToday=6 → block', () => {
    const state = baseState({ level: 3, notesToday: 6 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('daily cap');
  });
});

// =============================================================================
// Cooldown
// =============================================================================

describe('decideHeartbeat — topic cooldown', () => {
  it('same topic within 24h → block', () => {
    const state = baseState({ nowMs: T0 + 1000 });
    state.lastNoteOnTopicMs.set('topic-1', T0);
    const decision = decideHeartbeat(baseSignal({ topicId: 'topic-1' }), state);
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('cooldown');
  });

  it('same topic after 24h → pass', () => {
    const state = baseState({ nowMs: T0 + 25 * HOUR_MS });
    state.lastNoteOnTopicMs.set('topic-1', T0);
    const decision = decideHeartbeat(baseSignal({ topicId: 'topic-1' }), state);
    expect(decision.send).toBe(true);
  });

  it('different topic → no cooldown', () => {
    const state = baseState({ nowMs: T0 + 1000 });
    state.lastNoteOnTopicMs.set('topic-1', T0);
    const decision = decideHeartbeat(baseSignal({ topicId: 'topic-2' }), state);
    expect(decision.send).toBe(true);
  });
});

// =============================================================================
// Send score formula — per signal factor
// =============================================================================

describe('decideHeartbeat — relevance factor', () => {
  it('relevance=1 → passes', () => {
    const decision = decideHeartbeat(baseSignal({ relevance: 1 }), baseState());
    expect(decision.send).toBe(true);
  });

  it('relevance=0 → score 0 → block', () => {
    const decision = decideHeartbeat(baseSignal({ relevance: 0 }), baseState());
    expect(decision.send).toBe(false);
    expect(decision.score).toBe(0);
    expect(decision.blockReason).toBe('threshold');
  });

  it('relevance=0.5 pulls below level-1 threshold', () => {
    const decision = decideHeartbeat(
      baseSignal({ relevance: 0.5 }),
      baseState({ level: 1 }),
    );
    // 0.5 * 1 * 1 * (1-0) = 0.5 < 0.55
    expect(decision.send).toBe(false);
    expect(decision.score).toBeCloseTo(0.5);
  });
});

describe('decideHeartbeat — urgency factor', () => {
  it('urgency=1 → passes', () => {
    const decision = decideHeartbeat(baseSignal({ urgency: 1 }), baseState());
    expect(decision.send).toBe(true);
  });

  it('urgency=0.5 pulls below level-1 threshold', () => {
    const decision = decideHeartbeat(
      baseSignal({ urgency: 0.5 }),
      baseState({ level: 1 }),
    );
    expect(decision.send).toBe(false);
    expect(decision.score).toBeCloseTo(0.5);
  });
});

describe('decideHeartbeat — novelty factor', () => {
  it('novelty=1 → passes', () => {
    const decision = decideHeartbeat(baseSignal({ novelty: 1 }), baseState());
    expect(decision.send).toBe(true);
  });

  it('novelty=0 → score 0 → block', () => {
    const decision = decideHeartbeat(baseSignal({ novelty: 0 }), baseState());
    expect(decision.send).toBe(false);
    expect(decision.score).toBe(0);
  });
});

describe('decideHeartbeat — fatigue factor (Fa)', () => {
  it('notesToday/cap = 0.5 at level 3 with 3 notes → score 0.5', () => {
    const state = baseState({ level: 3, notesToday: 3 });
    const decision = decideHeartbeat(baseSignal(), state);
    // fatigue = 3/6 = 0.5 → 1*1*1*0.5 = 0.5 >= 0.40 → send
    expect(decision.send).toBe(true);
    expect(decision.score).toBeCloseTo(0.5);
    expect(decision.factors.fatigue).toBeCloseTo(0.5);
  });

  it('notesToday/cap = 0.833 → score 0.167 < 0.40 → block', () => {
    const state = baseState({ level: 3, notesToday: 5 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.score).toBeCloseTo(0.1667, 2);
    expect(decision.blockReason).toBe('threshold');
  });

  it('ignoreRate7d drives fatigue when notesToday=0', () => {
    const state = baseState({ ignoreRate7d: 0.5 });
    const decision = decideHeartbeat(baseSignal(), state);
    // fatigue = max(0, 0.5) = 0.5 → score 0.5 >= 0.40 → send
    expect(decision.factors.fatigue).toBeCloseTo(0.5);
    expect(decision.send).toBe(true);
  });

  it('high ignoreRate7d (0.9) → score 0.1 < threshold → block', () => {
    const state = baseState({ ignoreRate7d: 0.9 });
    const decision = decideHeartbeat(baseSignal(), state);
    expect(decision.send).toBe(false);
    expect(decision.score).toBeCloseTo(0.1);
  });
});

describe('decideHeartbeat — consent factor (K)', () => {
  it('consent=0 → block before score', () => {
    const state = baseState();
    state.consentByTrigger.reminder = false;
    const decision = decideHeartbeat(
      baseSignal({ triggerType: 'reminder' }),
      state,
    );
    expect(decision.send).toBe(false);
    expect(decision.blockReason).toBe('consent');
    expect(decision.score).toBe(0);
  });
});

// =============================================================================
// Threshold boundaries
// =============================================================================

describe('decideHeartbeat — threshold boundaries by level', () => {
  it('level 1: score 0.55 → send', () => {
    const state = baseState({ level: 1 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.55 }), state);
    expect(decision.send).toBe(true);
    expect(decision.score).toBeCloseTo(0.55);
  });

  it('level 1: score 0.54 → block', () => {
    const state = baseState({ level: 1 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.54 }), state);
    expect(decision.send).toBe(false);
    expect(decision.score).toBeCloseTo(0.54);
  });

  it('level 2: score 0.45 → send', () => {
    const state = baseState({ level: 2 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.45 }), state);
    expect(decision.send).toBe(true);
  });

  it('level 2: score 0.44 → block', () => {
    const state = baseState({ level: 2 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.44 }), state);
    expect(decision.send).toBe(false);
  });

  it('level 3: score 0.40 → send', () => {
    const state = baseState({ level: 3 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.40 }), state);
    expect(decision.send).toBe(true);
  });

  it('level 3: score 0.39 → block', () => {
    const state = baseState({ level: 3 });
    const decision = decideHeartbeat(baseSignal({ novelty: 0.39 }), state);
    expect(decision.send).toBe(false);
  });
});

// =============================================================================
// Formula — exact multiplication
// =============================================================================

describe('decideHeartbeat — full formula R×U×N×(1-Fa)', () => {
  it('R=1 U=1 N=1 Fa=0 → 1', () => {
    const decision = decideHeartbeat(baseSignal(), baseState());
    expect(decision.score).toBeCloseTo(1);
  });

  it('R=0.8 U=0.9 N=0.7 Fa=0.2 → 0.8*0.9*0.7*0.8 = 0.4032', () => {
    const state = baseState({ notesToday: 0, ignoreRate7d: 0 });
    // Force fatigue to 0.2 via ignoreRate7d
    state.ignoreRate7d = 0.2;
    const decision = decideHeartbeat(
      baseSignal({ relevance: 0.8, urgency: 0.9, novelty: 0.7 }),
      state,
    );
    expect(decision.score).toBeCloseTo(0.8 * 0.9 * 0.7 * 0.8, 3);
  });

  it('zero any of R/U/N → zero score', () => {
    const r = decideHeartbeat(baseSignal({ relevance: 0 }), baseState());
    const u = decideHeartbeat(baseSignal({ urgency: 0 }), baseState());
    const n = decideHeartbeat(baseSignal({ novelty: 0 }), baseState());
    expect(r.score).toBe(0);
    expect(u.score).toBe(0);
    expect(n.score).toBe(0);
  });
});

// =============================================================================
// Composer (PRD 10.6)
// =============================================================================

describe('composeProactiveNote — PRD 10.6', () => {
  it('valid note has body, why, and default actions', () => {
    const note = composeProactiveNote({
      trigger: 'reminder',
      bodyText: 'Your verification finished overnight.',
      whyText: 'You asked me to recheck it.',
    });
    expect(note.valid).toBe(true);
    expect(note.body.length).toBeGreaterThan(0);
    expect(note.why.length).toBeGreaterThan(0);
    expect(note.actions).toEqual([...DEFAULT_ACTIONS]);
    expect(note.wordCount).toBeLessThanOrEqual(MAX_WORDS);
  });

  it('empty body → invalid', () => {
    const note = composeProactiveNote({
      trigger: 'reminder',
      bodyText: '',
      whyText: 'Because.',
    });
    expect(note.valid).toBe(false);
    expect(note.reason).toContain('empty body');
  });

  it('missing why text → invalid', () => {
    const note = composeProactiveNote({
      trigger: 'reminder',
      bodyText: 'A note.',
      whyText: '',
    });
    expect(note.valid).toBe(false);
    expect(note.reason).toContain('why-text');
  });

  it('over 40 words → invalid + truncated body', () => {
    const longBody = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const note = composeProactiveNote({
      trigger: 'reminder',
      bodyText: longBody,
      whyText: 'Because.',
    });
    expect(note.valid).toBe(false);
    expect(note.wordCount).toBe(60);
    expect(note.body.split(' ').length).toBe(MAX_WORDS);
    expect(note.reason).toContain('exceeds');
  });

  it('custom actions override defaults', () => {
    const note = composeProactiveNote({
      trigger: 'reminder',
      bodyText: 'A note.',
      whyText: 'Because.',
      actions: ['Approve', 'Reject'],
    });
    expect(note.actions).toEqual(['Approve', 'Reject']);
  });
});
// === FILE END ===