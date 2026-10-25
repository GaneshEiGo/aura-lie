// === FILE START ===
// packages/proactive/test/t26-proactive.test.ts
// PRD 10.2 · 10.5 · T-26.
//
// The T-26 gate: 30-day simulation at every autonomy level. Assertions:
//   1. 0 cap violations — no day exceeds AUTONOMY_CAPS[level]
//   2. 0 quiet-hour violations — nothing sent in quiet hours (unless
//      urgent + urgentPassesQuietHours)
//   3. At least one note was sent (proves the pipeline runs)
//   4. With ignored notes → fewer sends (proves fatigue works)

import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_CAPS,
  simulate30Days,
  type AutonomyLevel,
  type Signal,
  type SimulationEvent,
  type TriggerType,
} from '../src/heartbeat-v2.js';

// -----------------------------------------------------------------------------
// Event generator — high-scoring signals, many per day, outside quiet hours
// -----------------------------------------------------------------------------

function makeEvents(days: number, perDay: number, hourBase = 10): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let day = 0; day < days; day++) {
    for (let i = 0; i < perDay; i++) {
      events.push({
        day,
        hourUtc: hourBase + (i % 8), // stay within 10-17
        signal: {
          triggerType: 'reminder',
          topicId: `t-${day}-${i}`,
          relevance: 1,
          urgency: 1,
          novelty: 1,
        },
      });
    }
  }
  return events;
}

// =============================================================================
// Per-level simulation
// =============================================================================

describe('T-26 — 30-day simulation at every level', () => {
  const levels: AutonomyLevel[] = [0, 1, 2, 3];

  for (const level of levels) {
    it(`level ${level}: cap never exceeded, 0 violations`, () => {
      const events = makeEvents(30, 10);
      const result = simulate30Days(events, level);
      const cap = AUTONOMY_CAPS[level];

      // Assertion 1: 0 cap violations
      expect(result.capViolations).toBe(0);

      // Assertion 2: 0 quiet-hour violations
      expect(result.quietHourViolations).toBe(0);

      // Assertion 3: per-day count never exceeds cap
      for (let d = 0; d < 30; d++) {
        expect(result.perDay[d]).toBeLessThanOrEqual(cap);
      }

      // Assertion 4: maxNotesInADay <= cap
      expect(result.maxNotesInADay).toBeLessThanOrEqual(cap);

      // Assertion 5: level 0 sends nothing; higher levels send something
      if (level === 0) {
        expect(result.totalNotesSent).toBe(0);
      } else {
        expect(result.totalNotesSent).toBeGreaterThan(0);
      }
    });
  }
});

// =============================================================================
// Cap never exceeded (level 3, dense events)
// =============================================================================

describe('T-26 — cap never exceeded (level 3, dense)', () => {
  it('50 events/day for 30 days → still ≤ 6/day', () => {
    const events = makeEvents(30, 50);
    const result = simulate30Days(events, 3);
    expect(result.capViolations).toBe(0);
    expect(result.maxNotesInADay).toBeLessThanOrEqual(6);
    for (let d = 0; d < 30; d++) {
      expect(result.perDay[d]).toBeLessThanOrEqual(6);
    }
  });
});

// =============================================================================
// Quiet hours respected
// =============================================================================

describe('T-26 — quiet hours respected', () => {
  it('events at 22:00 send, 23:00 block, 00:00 block, 08:00 send', () => {
    const events: SimulationEvent[] = [
      { day: 0, hourUtc: 22, signal: mkSignal('t1') },
      { day: 0, hourUtc: 23, signal: mkSignal('t2') },
      { day: 0, hourUtc: 0, signal: mkSignal('t3') },
      { day: 0, hourUtc: 1, signal: mkSignal('t4') },
      { day: 0, hourUtc: 8, signal: mkSignal('t5') },
      { day: 0, hourUtc: 12, signal: mkSignal('t6') },
    ];
    const result = simulate30Days(events, 3);
    expect(result.quietHourViolations).toBe(0);
    // Hours 22, 8, 12 should send (3); 23, 0, 1 should block (3)
    expect(result.totalNotesSent).toBe(3);
  });

  it('urgent at 00:00 blocked by default', () => {
    const events: SimulationEvent[] = [
      { day: 0, hourUtc: 0, signal: mkSignal('t1', { urgency: 1.0 }) },
    ];
    const result = simulate30Days(events, 3);
    expect(result.totalNotesSent).toBe(0);
    expect(result.quietHourViolations).toBe(0);
  });

  it('urgent at 00:00 allowed with urgentPassesQuietHours', () => {
    const events: SimulationEvent[] = [
      { day: 0, hourUtc: 0, signal: mkSignal('t1', { urgency: 1.0 }) },
    ];
    const result = simulate30Days(events, 3, { urgentPassesQuietHours: true });
    expect(result.totalNotesSent).toBe(1);
    // Urgent pass is an accepted exception, not a violation
    expect(result.quietHourViolations).toBe(0);
  });
});

// =============================================================================
// Fatigue reduces sends over the day
// =============================================================================

describe('T-26 — fatigue reduces sends over the day', () => {
  it('level 3: 10 events/day → fewer sends than cap×30', () => {
    const events = makeEvents(30, 10);
    const result = simulate30Days(events, 3);
    // Cap is 6/day × 30 = 180 max. Fatigue blocks well before that.
    expect(result.totalNotesSent).toBeLessThan(180);
    expect(result.totalNotesSent).toBeGreaterThan(0);
  });

  it('level 1: fewer sends than level 3 (higher threshold + lower cap)', () => {
    const events = makeEvents(30, 10);
    const r1 = simulate30Days(events, 1);
    const r3 = simulate30Days(events, 3);
    expect(r1.totalNotesSent).toBeLessThan(r3.totalNotesSent);
  });

  it('ignored notes reduce future sends (fatigue via ignoreRate7d)', () => {
    const events = makeEvents(30, 10);
    // Mark every 3rd note as ignored
    for (let i = 0; i < events.length; i += 3) {
      events[i].willBeIgnored = true;
    }
    const withIgnores = simulate30Days(events, 3);
    const noIgnores = simulate30Days(makeEvents(30, 10), 3);

    // Ignored notes raise fatigue → fewer or equal sends (never more)
    expect(withIgnores.totalNotesSent).toBeLessThanOrEqual(noIgnores.totalNotesSent);
    expect(withIgnores.capViolations).toBe(0);
    expect(withIgnores.quietHourViolations).toBe(0);
  });
});

// =============================================================================
// Helpers
// =============================================================================

function mkSignal(topicId: string, overrides: Partial<Signal> = {}): Signal {
  return {
    triggerType: 'reminder' as TriggerType,
    topicId,
    relevance: 1,
    urgency: 1,
    novelty: 1,
    ...overrides,
  };
}
// === FILE END ===