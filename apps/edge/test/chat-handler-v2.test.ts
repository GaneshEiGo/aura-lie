// === FILE START ===
// apps/edge/test/chat-handler-v2.test.ts
// PRD 7.2 · 7.7 · 7.8 · FR-CHAT-01 · T-20 · T-22 · T-23.
//
// Three gates in one file:
//   T-22 — every degradation level emits the right notice
//   T-23 — outbox preserves order, no duplicates
//   T-20 — latency honesty: monotonic trace.tMs, real done.elapsedMs
//
// Plus SSE wire-format round-trip tests.

import { describe, it, expect } from 'vitest';
import {
  formatSseEvent,
  parseSseFrame,
  noticeForLevel,
  Outbox,
  createTurnStream,
  serialiseStream,
  type ChatEvent,
  type DegradationLevel,
  type Mode,
  type Sensitivity,
  type TurnStreamInput,
} from '../src/chat-handler-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function baseInput(overrides: Partial<TurnStreamInput> = {}): TurnStreamInput {
  return {
    turnId: 't-1',
    mode: 'instant',
    persona: 'Aura-lie',
    sensitivity: 'S0',
    riskTier: 1,
    routeRole: 'chat_fast',
    routeFamily: 'groq',
    tokens: ['Hello', ' ', 'world', '.'],
    calls: 1,
    tokenCount: 4,
    ...overrides,
  };
}

// =============================================================================
// SSE wire format
// =============================================================================

describe('SSE wire format', () => {
  it('formatSseEvent produces `data: <json>\\n\\n`', () => {
    const evt: ChatEvent = { type: 'token', delta: 'hi' };
    const frame = formatSseEvent(evt);
    expect(frame).toBe('data: {"type":"token","delta":"hi"}\n\n');
  });

  it('parseSseFrame round-trips a token', () => {
    const evt: ChatEvent = { type: 'token', delta: 'hello world' };
    const parsed = parseSseFrame(formatSseEvent(evt));
    expect(parsed).toEqual(evt);
  });

  it('parseSseFrame round-trips every event type', () => {
    const events: ChatEvent[] = [
      {
        v: 1,
        type: 'meta',
        turnId: 't1',
        mode: 'instant',
        persona: 'Aura-lie',
        sensitivity: 'S0',
        riskTier: 1,
        routeRole: 'chat_fast',
        routeFamily: 'groq',
      },
      { type: 'trace', seq: 0, tMs: 0, kind: 'step', text: 'plan' },
      {
        type: 'thinking',
        delta: 'reasoning…',
        provider: 'groq',
        model: 'gpt-oss-20b',
        kind: 'summary',
      },
      { type: 'token', delta: 'x' },
      { type: 'claim', id: 'c1', text: 'A claim.', claimType: 'fact', importance: 1 },
      {
        type: 'source',
        id: 's1',
        title: 'Page',
        domain: 'example.com',
        tier: 'primary',
        independenceGroup: 'k1',
      },
      { type: 'score', claimId: 'c1', score: 92, status: 'VERIFIED' },
      {
        type: 'summary',
        overall: 92,
        checked: 1,
        checkable: 1,
        chip: 'VERIFIED',
        heuristic: true,
      },
      {
        type: 'notice',
        severity: 'info',
        code: 'X',
        text: 'Notice text.',
      },
      { type: 'done', elapsedMs: 42, calls: 1, tokens: 1, costInr: 0 },
      {
        type: 'error',
        code: 'E',
        userMessage: 'Something broke.',
        retryHint: 'Try again.',
      },
    ];
    for (const evt of events) {
      const parsed = parseSseFrame(formatSseEvent(evt));
      expect(parsed).toEqual(evt);
    }
  });

  it('parseSseFrame returns null on malformed input', () => {
    expect(parseSseFrame('')).toBeNull();
    expect(parseSseFrame('garbage')).toBeNull();
    expect(parseSseFrame('data: {not-json')).toBeNull();
    expect(parseSseFrame('data: {"no_type":1}')).toBeNull();
  });

  it('parseSseFrame tolerates trailing whitespace', () => {
    const evt: ChatEvent = { type: 'token', delta: 'x' };
    const parsed = parseSseFrame(formatSseEvent(evt) + '   ');
    expect(parsed).toEqual(evt);
  });
});

// =============================================================================
// T-22 GATE — degradation notices (all 6 levels)
// =============================================================================

describe('T-22 GATE — degradation notices (D0–D5)', () => {
  it('D0 → null (no notice)', () => {
    expect(noticeForLevel('D0')).toBeNull();
  });

  it('D1 → info notice about fallback', () => {
    const n = noticeForLevel('D1');
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('info');
    expect(n!.code).toBe('D1_fallback');
    expect(n!.text.toLowerCase()).toContain('switched');
  });

  it('D2 → info notice about loop step-down (PRD 5.13 verbatim)', () => {
    const n = noticeForLevel('D2');
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('info');
    expect(n!.code).toBe('D2_degraded_loop');
    expect(n!.text).toBe(
      'Think needs more quota than is left. I ran Instant instead.',
    );
  });

  it('D3 → warn notice about limited mode', () => {
    const n = noticeForLevel('D3');
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('warn');
    expect(n!.code).toBe('D3_small_model');
    expect(n!.text.toLowerCase()).toContain('limited mode');
  });

  it('D4 → warn notice about Core Mode (PRD 5.13 verbatim)', () => {
    const n = noticeForLevel('D4');
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('warn');
    expect(n!.code).toBe('D4_core_mode');
    expect(n!.text.startsWith('Cloud models are resting until 05:30 IST.')).toBe(true);
  });

  it('D5 → error notice about offline (PRD 5.13 verbatim)', () => {
    const n = noticeForLevel('D5');
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('error');
    expect(n!.code).toBe('D5_offline');
    expect(n!.text).toBe('No internet. Showing what’s on this device.');
  });

  it('every level from D0..D5 has a distinct mapping', () => {
    const levels: DegradationLevel[] = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];
    const codes = new Set<string>();
    for (const level of levels) {
      const n = noticeForLevel(level);
      if (n !== null) codes.add(n.code);
    }
    expect(codes.size).toBe(5); // D0 has no code
    expect(codes).toEqual(
      new Set(['D1_fallback', 'D2_degraded_loop', 'D3_small_model', 'D4_core_mode', 'D5_offline']),
    );
  });
});

// =============================================================================
// T-23 GATE — offline outbox
// =============================================================================

describe('T-23 GATE — offline outbox', () => {
  it('enqueue adds an item and returns true', () => {
    const ob = new Outbox({ now: () => 1000 });
    expect(ob.enqueue({ id: 'a', turnId: 't1', text: 'hello', mode: 'instant' })).toBe(true);
    expect(ob.size()).toBe(1);
    expect(ob.has('a')).toBe(true);
  });

  it('enqueue rejects duplicates by id', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'hello', mode: 'instant' });
    expect(ob.enqueue({ id: 'a', turnId: 't1', text: 'different', mode: 'think' })).toBe(false);
    expect(ob.size()).toBe(1);
  });

  it('drain preserves insertion order', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'first', mode: 'instant' });
    ob.enqueue({ id: 'b', turnId: 't2', text: 'second', mode: 'instant' });
    ob.enqueue({ id: 'c', turnId: 't3', text: 'third', mode: 'instant' });
    const completed = new Set(['a', 'b', 'c']);
    const drained = ob.drain(completed);
    expect(drained.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(ob.size()).toBe(0);
  });

  it('drain only removes completed items, preserves order of the rest', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'first', mode: 'instant' });
    ob.enqueue({ id: 'b', turnId: 't2', text: 'second', mode: 'instant' });
    ob.enqueue({ id: 'c', turnId: 't3', text: 'third', mode: 'instant' });
    const drained = ob.drain(new Set(['a', 'c']));
    expect(drained.map((i) => i.id)).toEqual(['a', 'c']);
    expect(ob.size()).toBe(1);
    expect(ob.all()[0].id).toBe('b');
  });

  it('drain releases ids so they can be re-enqueued', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'hello', mode: 'instant' });
    ob.drain(new Set(['a']));
    expect(ob.has('a')).toBe(false);
    expect(ob.enqueue({ id: 'a', turnId: 't1', text: 'hello again', mode: 'instant' })).toBe(true);
  });

  it('drain preserves all pending items when nothing is completed', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'one', mode: 'instant' });
    ob.enqueue({ id: 'b', turnId: 't2', text: 'two', mode: 'instant' });
    const drained = ob.drain(new Set());
    expect(drained.length).toBe(0);
    expect(ob.size()).toBe(2);
  });

  it('remove returns the item and updates size', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'one', mode: 'instant' });
    ob.enqueue({ id: 'b', turnId: 't2', text: 'two', mode: 'instant' });
    const removed = ob.remove('a');
    expect(removed).not.toBeNull();
    expect(removed!.id).toBe('a');
    expect(ob.size()).toBe(1);
    expect(ob.all()[0].id).toBe('b');
  });

  it('remove on missing returns null (no state change)', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'one', mode: 'instant' });
    expect(ob.remove('missing')).toBeNull();
    expect(ob.size()).toBe(1);
  });

  it('clear empties everything', () => {
    const ob = new Outbox({ now: () => 1000 });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'one', mode: 'instant' });
    ob.clear();
    expect(ob.size()).toBe(0);
    expect(ob.has('a')).toBe(false);
  });

  it('enqueuedAt uses the injected clock', () => {
    let t = 5000;
    const ob = new Outbox({ now: () => t });
    ob.enqueue({ id: 'a', turnId: 't1', text: 'one', mode: 'instant' });
    expect(ob.all()[0].enqueuedAt).toBe(5000);
    t = 6000;
    ob.enqueue({ id: 'b', turnId: 't2', text: 'two', mode: 'instant' });
    expect(ob.all()[1].enqueuedAt).toBe(6000);
  });

  it('no duplication under 100 repeated enqueues of same id', () => {
    const ob = new Outbox({ now: () => 1000 });
    for (let i = 0; i < 100; i++) {
      ob.enqueue({ id: 'same', turnId: 't1', text: `attempt ${i}`, mode: 'instant' });
    }
    expect(ob.size()).toBe(1);
    expect(ob.all()[0].text).toBe('attempt 0');
  });
});

// =============================================================================
// T-20 GATE — latency honesty
// =============================================================================

describe('T-20 GATE — latency honesty', () => {
  it('trace.tMs is monotonic across the stream', () => {
    const events = createTurnStream(
      baseInput({
        tokens: ['a', 'b', 'c', 'd'],
        traceBeforeToken: {
          0: ['plan'],
          1: ['retrieve'],
          2: ['check'],
          3: ['score'],
        },
      }),
    );
    const traces = events.filter((e) => e.type === 'trace') as Extract<
      ChatEvent,
      { type: 'trace' }
    >[];
    expect(traces.length).toBe(4);
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i].tMs).toBeGreaterThan(traces[i - 1].tMs);
    }
  });

  it('trace.seq is monotonic and 0-based', () => {
    const events = createTurnStream(
      baseInput({
        traceBeforeToken: {
          0: ['a'],
          1: ['b'],
          2: ['c'],
        },
      }),
    );
    const traces = events.filter((e) => e.type === 'trace') as Extract<
      ChatEvent,
      { type: 'trace' }
    >[];
    expect(traces.map((t) => t.seq)).toEqual([0, 1, 2]);
  });

  it('done.elapsedMs reflects wall-clock time from meta to done', () => {
    let t = 1000;
    const now = () => {
      const v = t;
      t += 100;
      return v;
    };
    const events = createTurnStream(baseInput({ now }));
    const done = events[events.length - 1] as Extract<ChatEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    // Two calls to `now` (start + end), each +100 → elapsedMs = 100
    expect(done.elapsedMs).toBe(100);
  });

  it('done.elapsedMs is 0 when clock does not advance', () => {
    const events = createTurnStream(baseInput({ now: () => 5000 }));
    const done = events[events.length - 1] as Extract<ChatEvent, { type: 'done' }>;
    expect(done.elapsedMs).toBe(0);
  });

  it('done carries real calls and tokens from the input', () => {
    const events = createTurnStream(
      baseInput({ tokens: ['a', 'b', 'c'], calls: 3, tokenCount: 3 }),
    );
    const done = events[events.length - 1] as Extract<ChatEvent, { type: 'done' }>;
    expect(done.calls).toBe(3);
    expect(done.tokens).toBe(3);
    expect(done.costInr).toBe(0);
  });

  it('serialiseStream produces one valid SSE frame per event', () => {
    const events = createTurnStream(baseInput());
    const wire = serialiseStream(events);
    // Each frame ends with \n\n — split and count
    const frames = wire.split('\n\n').filter((f) => f.trim().length > 0);
    expect(frames.length).toBe(events.length);
    for (const frame of frames) {
      expect(parseSseFrame(frame)).not.toBeNull();
    }
  });
});

// =============================================================================
// Event ordering — spec-locked
// =============================================================================

describe('createTurnStream — event ordering', () => {
  it('meta is always first', () => {
    const events = createTurnStream(baseInput());
    expect(events[0].type).toBe('meta');
  });

  it('done is always last', () => {
    const events = createTurnStream(baseInput());
    expect(events[events.length - 1].type).toBe('done');
  });

  it('degradation notice comes right after meta', () => {
    const events = createTurnStream(baseInput({ degradation: 'D4' }));
    expect(events[0].type).toBe('meta');
    expect(events[1].type).toBe('notice');
    const notice = events[1] as Extract<ChatEvent, { type: 'notice' }>;
    expect(notice.code).toBe('D4_core_mode');
  });

  it('summary comes before done', () => {
    const events = createTurnStream(
      baseInput({
        summary: {
          overall: 92,
          checked: 1,
          checkable: 1,
          chip: 'VERIFIED',
          heuristic: true,
        },
      }),
    );
    const types = events.map((e) => e.type);
    expect(types.indexOf('summary')).toBeLessThan(types.indexOf('done'));
  });

  it('trace lines are interleaved with tokens per traceBeforeToken', () => {
    const events = createTurnStream(
      baseInput({
        tokens: ['Hello', ' world'],
        traceBeforeToken: { 0: ['plan'], 1: ['check'] },
      }),
    );
    // Expected sequence: meta, trace(plan), token(Hello), trace(check), token( world), done
    const types = events.map((e) => e.type);
    expect(types).toEqual(['meta', 'trace', 'token', 'trace', 'token', 'done']);
  });

  it('no tokens → meta + done only', () => {
    const events = createTurnStream(baseInput({ tokens: [], tokenCount: 0 }));
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('meta');
    expect(events[1].type).toBe('done');
  });
});

// =============================================================================
// Four modes wire correctly
// =============================================================================

describe('createTurnStream — 4 modes', () => {
  const modes: Mode[] = ['instant', 'think', 'research', 'council'];
  for (const mode of modes) {
    it(`${mode} mode sets meta.mode correctly`, () => {
      const events = createTurnStream(baseInput({ mode }));
      const meta = events[0] as Extract<ChatEvent, { type: 'meta' }>;
      expect(meta.mode).toBe(mode);
    });
  }
});

// =============================================================================
// Sensitivity passes through
// =============================================================================

describe('createTurnStream — sensitivity', () => {
  const sens: Sensitivity[] = ['S0', 'S1', 'S2'];
  for (const s of sens) {
    it(`${s} sensitivity preserved in meta`, () => {
      const events = createTurnStream(baseInput({ sensitivity: s }));
      const meta = events[0] as Extract<ChatEvent, { type: 'meta' }>;
      expect(meta.sensitivity).toBe(s);
    });
  }
});

// =============================================================================
// Empty / edge cases
// =============================================================================

describe('createTurnStream — edge cases', () => {
  it('no degradation → no notice event', () => {
    const events = createTurnStream(baseInput());
    const notices = events.filter((e) => e.type === 'notice');
    expect(notices.length).toBe(0);
  });

  it('D0 degradation → no notice (matches PRD)', () => {
    const events = createTurnStream(baseInput({ degradation: 'D0' }));
    const notices = events.filter((e) => e.type === 'notice');
    expect(notices.length).toBe(0);
  });

  it('no summary → no summary event', () => {
    const events = createTurnStream(baseInput());
    const summaries = events.filter((e) => e.type === 'summary');
    expect(summaries.length).toBe(0);
  });

  it('meta.costInr is always 0 on done', () => {
    const events = createTurnStream(baseInput());
    const done = events[events.length - 1] as Extract<ChatEvent, { type: 'done' }>;
    expect(done.costInr).toBe(0);
  });
});
// === FILE END ===