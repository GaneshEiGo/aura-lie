// packages/stream-proxy/test/stream-proxy.test.ts
import { describe, it, expect } from 'vitest';
import {
  streamThrough,
  parseSseChunk,
  emitSse,
  SUBREQUEST_HARD_CAP,
  LOOP_PLANNING_BUDGET,
  PLANNING_BUDGET,
  planningBudgetFor,
} from '../src/index.js';
import type {
  ChatEvent,
  ChatRequest,
  ProviderAdapter,
  ProviderChatEvent,
} from '../src/types.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function fixedClock(at: number): {
  clock: { now(): number };
  add: (d: number) => void;
} {
  let current = at;
  return {
    clock: { now: () => current },
    add: (d: number) => {
      current += d;
    },
  };
}

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    turnId: 'turn-1',
    model: 'llama-3.3-70b',
    messages: [{ role: 'user', content: 'hello' }],
    mode: 'instant',
    sensitivity: 'S0',
    ...overrides,
  };
}

function makeAdapter(
  events: ProviderChatEvent[],
  id = 'test',
): ProviderAdapter {
  return {
    id,
    lane: 'private',
    chat: async function* () {
      for (const e of events) yield e;
    },
  };
}

function makeGeneratorAdapter(
  gen: () => AsyncIterable<ProviderChatEvent>,
  id = 'test',
): ProviderAdapter {
  return { id, lane: 'private', chat: () => gen() };
}

const META = {
  persona: 'Aura-lie',
  route: { role: 'fast', family: 'groq' },
  riskTier: 1 as const,
  mode: 'instant' as const,
};

// -----------------------------------------------------------------------------
describe('Stream Proxy (PRD 7.7, 13.3, 13.4, 7.15)', () => {
  // ---- Budget constants -------------------------------------------
  it('SUBREQUEST_HARD_CAP matches PRD 13.3 (50 per request)', () => {
    expect(SUBREQUEST_HARD_CAP).toBe(50);
  });

  it('LOOP_PLANNING_BUDGET matches PRD 13.3 loop budgets', () => {
    expect(LOOP_PLANNING_BUDGET.light).toBe(20);
    expect(LOOP_PLANNING_BUDGET.standard).toBe(20);
    expect(LOOP_PLANNING_BUDGET.deep).toBe(35);
  });

  it('planningBudgetFor returns per-mode PRD 13.3 budgets', () => {
    expect(PLANNING_BUDGET.instant).toBe(20);
    expect(PLANNING_BUDGET.think).toBe(30);
    expect(PLANNING_BUDGET.research).toBe(35);
    expect(planningBudgetFor('instant')).toBe(20);
    expect(planningBudgetFor('think')).toBe(30);
    expect(planningBudgetFor('research')).toBe(35);
  });

  // ---- SSE helpers ------------------------------------------------
  it('parseSseChunk splits two-frame SSE payloads', () => {
    const raw =
      'event: a\ndata: {"x":1}\n\n' + 'event: b\ndata: {"y":2}\n\n';
    const frames = parseSseChunk(raw);
    expect(frames.length).toBe(2);
    expect(frames[0].event).toBe('a');
    expect(frames[0].data).toBe('{"x":1}');
    expect(frames[1].event).toBe('b');
    expect(frames[1].data).toBe('{"y":2}');
  });

  it('parseSseChunk handles multi-line data blocks', () => {
    const raw = 'event: m\ndata: line1\ndata: line2\n\n';
    const frames = parseSseChunk(raw);
    expect(frames.length).toBe(1);
    expect(frames[0].data).toBe('line1\nline2');
  });

  it('emitSse serializes a ChatEvent with the correct event type', () => {
    const event: ChatEvent = { t: 'token', delta: 'hello' };
    const sse = emitSse(event);
    expect(sse).toMatch(/^event: token\n/);
    expect(sse).toContain('"delta":"hello"');
    expect(sse.endsWith('\n\n')).toBe(true);
  });

  // ---- streamThrough: happy path ----------------------------------
  it('emits meta first, then tokens, then done', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'Hello' },
      { kind: 'content', delta: ' world' },
      { kind: 'usage', promptTokens: 10, completionTokens: 2 },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });

    expect(result.events[0].t).toBe('meta');
    expect(result.events[result.events.length - 1].t).toBe('done');
    const tokens = result.events.filter((e) => e.t === 'token');
    expect(tokens.length).toBe(2);
    expect(result.errored).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it('maps reasoning to thinking (PRD 7.10 normalisation)', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      {
        kind: 'reasoning',
        delta: 'I should answer',
        provider: 'groq',
        model: 'gpt-oss-120b',
        format: 'summary',
      },
      { kind: 'content', delta: 'The answer is 42.' },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });

    const thinking = result.events.find((e) => e.t === 'thinking');
    expect(thinking).toBeDefined();
    if (thinking && thinking.t === 'thinking') {
      expect(thinking.delta).toBe('I should answer');
      expect(thinking.provider).toBe('groq');
      expect(thinking.kind).toBe('summary');
    }
  });

  it('done event carries costInr = 0 (Law L1)', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'x' },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    const done = result.events[result.events.length - 1];
    expect(done.t).toBe('done');
    if (done.t === 'done') {
      expect(done.costInr).toBe(0);
    }
  });

  it('done event reports tokens summed from usage parts', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'a' },
      { kind: 'usage', promptTokens: 12, completionTokens: 3 },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.promptTokens).toBe(12);
    expect(result.completionTokens).toBe(3);
    const done = result.events[result.events.length - 1];
    if (done.t === 'done') {
      expect(done.tokens).toBe(15);
    }
  });

  it('duration is tracked via the injected clock', async () => {
    const { clock, add } = fixedClock(1000);
    const adapter = makeGeneratorAdapter(async function* () {
      yield { kind: 'content', delta: 'a' };
      add(50);
      yield { kind: 'finish', reason: 'stop' };
    });

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.durationMs).toBe(50);
  });

  it('bytes in and bytes out are both tracked', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'a' },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.bytesIn).toBeGreaterThan(0);
    expect(result.bytesOut).toBeGreaterThan(0);
  });

  // ---- Error paths -------------------------------------------------
  it('finish:error yields error event, then done (errored=true)', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'partial' },
      { kind: 'finish', reason: 'error', errorCode: 'rate_limited' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.errored).toBe(true);
    const errorEv = result.events.find((e) => e.t === 'error');
    expect(errorEv).toBeDefined();
    if (errorEv && errorEv.t === 'error') {
      expect(errorEv.code).toBe('rate_limited');
    }
    const done = result.events[result.events.length - 1];
    expect(done.t).toBe('done');
  });

  it('adapter throw yields error event, then done', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeGeneratorAdapter(async function* () {
      yield { kind: 'content', delta: 'a' };
      throw new Error('boom');
    });

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.errored).toBe(true);
    const errorEv = result.events.find((e) => e.t === 'error');
    expect(errorEv).toBeDefined();
    if (errorEv && errorEv.t === 'error') {
      expect(errorEv.code).toBe('adapter_threw');
      expect(errorEv.userMessage).toBe('boom');
    }
    expect(result.events[result.events.length - 1].t).toBe('done');
  });

  it('stream ends without finish yields notice + done (not errored)', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'a' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
    });
    expect(result.errored).toBe(false);
    expect(result.exhausted).toBe(false);
    const notice = result.events.find((e) => e.t === 'notice');
    expect(notice).toBeDefined();
    if (notice && notice.t === 'notice') {
      expect(notice.code).toBe('stream_ended_without_finish');
    }
    expect(result.events[result.events.length - 1].t).toBe('done');
  });

  // ---- Subrequest budget -------------------------------------------
  it('enforces subrequest budget and emits continue when exceeded', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'a' },
      { kind: 'subrequest', cost: 1 },
      { kind: 'content', delta: 'b' },
      { kind: 'subrequest', cost: 1 },
      { kind: 'content', delta: 'c' },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest(), {
      clock,
      meta: META,
      maxSubrequests: 2,
    });

    expect(result.exhausted).toBe(true);
    const cont = result.events.find((e) => e.t === 'continue');
    expect(cont).toBeDefined();
    if (cont && cont.t === 'continue') {
      expect(cont.reason).toMatch(/budget 2 exhausted/);
      expect(cont.stepToken).toMatch(/continue-turn-1-/);
    }
    const tokens = result.events.filter((e) => e.t === 'token');
    expect(tokens.length).toBe(1);
    expect(result.events[result.events.length - 1].t).toBe('done');
  });

  it('respects the meta shape across route modes', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter([
      { kind: 'content', delta: 'x' },
      { kind: 'finish', reason: 'stop' },
    ]);

    const result = await streamThrough(adapter, makeRequest({ mode: 'think' }), {
      clock,
      meta: { ...META, mode: 'think' },
    });
    const meta = result.events[0];
    expect(meta.t).toBe('meta');
    if (meta.t === 'meta') {
      expect(meta.mode).toBe('think');
      expect(meta.sensitivity).toBe('S0');
      expect(meta.route.role).toBe('fast');
      expect(meta.persona).toBe('Aura-lie');
    }
  });
});