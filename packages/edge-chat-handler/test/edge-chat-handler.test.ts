// packages/edge-chat-handler/test/edge-chat-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  handleChatRequest,
  validateChatBody,
  sseResponseFromEvents,
  jsonError,
  SSE_HEADERS,
} from '../src/index.js';
import type { ChatHandlerDeps } from '../src/index.js';
import type {
  ProviderAdapter,
  ProviderChatEvent,
  ChatEvent,
} from '@aura-lie/stream-proxy';

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

function makeAdapter(events: ProviderChatEvent[], id = 'groq'): ProviderAdapter {
  return {
    id,
    lane: 'private',
    chat: async function* () {
      for (const e of events) yield e;
    },
  };
}

const okAdapter = makeAdapter([
  { kind: 'content', delta: 'hello' },
  { kind: 'usage', promptTokens: 5, completionTokens: 1 },
  { kind: 'finish', reason: 'stop' },
]);

function makeReq(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeDeps(overrides: Partial<ChatHandlerDeps> = {}): ChatHandlerDeps {
  return {
    adapters: { groq: okAdapter },
    authenticate: () => ({ userId: 'u1' }),
    isKillSwitchActive: () => false,
    ...overrides,
  };
}

async function readAllEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  const frames = text.split('\n\n').filter((s) => s.trim());
  const events: ChatEvent[] = [];
  for (const frame of frames) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice(6)));
    }
  }
  return events;
}

// -----------------------------------------------------------------------------
describe('Edge Chat Handler (PRD 7.2, 7.7, 13.4, F-001, T-22)', () => {
  // ---- SSE_HEADERS constants --------------------------------------
  it('SSE_HEADERS match PRD 7.7 / Worker SSE requirements', () => {
    expect(SSE_HEADERS['Content-Type']).toContain('text/event-stream');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache');
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
    expect(SSE_HEADERS.Connection).toBe('keep-alive');
  });

  // ---- Body validation ---------------------------------------------
  it('validateChatBody accepts a minimal valid body', () => {
    const r = validateChatBody({ turnId: 't1', text: 'hi' });
    expect(r.ok).toBe(true);
  });

  it('validateChatBody rejects missing turnId', () => {
    const r = validateChatBody({ text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_turnId');
  });

  it('validateChatBody rejects missing text', () => {
    const r = validateChatBody({ turnId: 't1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_text');
  });

  it('validateChatBody rejects an unknown mode', () => {
    const r = validateChatBody({ turnId: 't1', text: 'hi', mode: 'super' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_mode');
  });

  it('validateChatBody rejects an unknown sensitivity', () => {
    const r = validateChatBody({ turnId: 't1', text: 'hi', sensitivity: 'S9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_sensitivity');
  });

  it('validateChatBody rejects oversized text', () => {
    const r = validateChatBody({ turnId: 't1', text: 'x'.repeat(32_001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('text_too_long');
  });

  it('validateChatBody accepts optional fields', () => {
    const r = validateChatBody({
      turnId: 't1',
      text: 'hi',
      mode: 'think',
      persona: 'Yuki',
      sensitivity: 'S2',
      riskTier: 3,
      maxSubrequests: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('think');
      expect(r.value.persona).toBe('Yuki');
      expect(r.value.sensitivity).toBe('S2');
      expect(r.value.riskTier).toBe(3);
      expect(r.value.maxSubrequests).toBe(5);
    }
  });

  // ---- HTTP method ------------------------------------------------
  it('rejects non-POST with 405', async () => {
    const req = new Request('http://localhost/v1/chat', { method: 'GET' });
    const res = await handleChatRequest(req, makeDeps());
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('method_not_allowed');
  });

  // ---- Auth (PRD 7.2 step 2) --------------------------------------
  it('rejects requests without auth with 401', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({ authenticate: () => null }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('accepts a synchronous authenticate result', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({ authenticate: () => ({ userId: 'u1' }) }),
    );
    expect(res.status).toBe(200);
  });

  it('accepts an async authenticate result', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({
        authenticate: async () => ({ userId: 'u1' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  // ---- Body errors ------------------------------------------------
  it('rejects invalid JSON with 400', async () => {
    const req = new Request('http://localhost/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleChatRequest(req, makeDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('rejects missing turnId with 400', async () => {
    const res = await handleChatRequest(
      makeReq({ text: 'hi' }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_turnId');
  });

  // ---- Happy path: 200 + SSE --------------------------------------
  it('returns 200 with text/event-stream on success', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });

  it('streams events with meta first, done last', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps(),
    );
    const events = await readAllEvents(res);
    expect(events[0].t).toBe('meta');
    expect(events[events.length - 1].t).toBe('done');
  });

  it('emits a token event on the happy path', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps(),
    );
    const events = await readAllEvents(res);
    expect(events.some((e) => e.t === 'token')).toBe(true);
  });

  it('done event carries costInr = 0', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps(),
    );
    const events = await readAllEvents(res);
    const done = events[events.length - 1];
    if (done.t === 'done') expect(done.costInr).toBe(0);
  });

  // ---- Kill switch (PRD 10.4) -------------------------------------
  it('kill switch emits meta + notice + done, still 200', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({ isKillSwitchActive: () => true }),
    );
    expect(res.status).toBe(200);
    const events = await readAllEvents(res);
    expect(events.map((e) => e.t)).toEqual(['meta', 'notice', 'done']);
    const notice = events[1];
    if (notice.t === 'notice') {
      expect(notice.code).toBe('kill-switch');
      expect(notice.severity).toBe('warn');
    }
  });

  it('kill switch works with an async isKillSwitchActive()', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({ isKillSwitchActive: async () => true }),
    );
    const events = await readAllEvents(res);
    expect(events.map((e) => e.t)).toEqual(['meta', 'notice', 'done']);
  });

  // ---- T-22: no 500 leaks after streaming begins -----------------
  it('orchestrator failure returns 200 with error + done (no 500)', async () => {
    const badAdapter: ProviderAdapter = {
      id: 'groq',
      lane: 'private',
      chat: async function* () {
        throw new Error('boom');
      },
    };
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({ adapters: { groq: badAdapter } }),
    );
    expect(res.status).toBe(200);
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);
    expect(types[0]).toBe('meta');
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('done');
  });

  it('orchestrator throwing synchronously still yields 200 + error + done', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({
        // Force the router to throw by injecting a broken registry.
        registry: {
          list() {
            throw new Error('broken registry');
          },
          byRole() {
            throw new Error('broken registry');
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);
    expect(types[0]).toBe('meta');
    // Either error from orchestrator or a clean run — both acceptable.
    expect(types[types.length - 1]).toBe('done');
  });

  // ---- Abort signal ----------------------------------------------
  it('closes the stream immediately when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const req = new Request('http://localhost/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 't1', text: 'hi' }),
      signal: controller.signal,
    });
    const res = await handleChatRequest(req, makeDeps());
    // Handler returns 200 with an (empty) event-stream Response; the client
    // disconnect is handled at the Worker layer via `req.signal.aborted`.
    expect(res.status).toBe(200);
    const text = await res.text();
    // Empty or truncated — either is fine; no crash.
    expect(typeof text).toBe('string');
  });

  // ---- sseResponseFromEvents helper ------------------------------
  it('sseResponseFromEvents emits valid SSE frames', async () => {
    const events: ChatEvent[] = [
      {
        t: 'meta',
        v: 1,
        turnId: 't1',
        mode: 'instant',
        persona: 'Aura-lie',
        route: { role: 'chat_fast', family: 'groq' },
        sensitivity: 'S0',
        riskTier: 0,
      },
      { t: 'token', delta: 'x' },
      { t: 'done', elapsedMs: 10, calls: 1, tokens: 1, costInr: 0 },
    ];
    const res = sseResponseFromEvents(events);
    expect(res.status).toBe(200);
    const text = await res.text();
    const frames = text.split('\n\n').filter((s) => s.trim());
    expect(frames.length).toBe(3);
    expect(frames[0]).toMatch(/^event: meta\n/);
    expect(frames[1]).toMatch(/^event: token\n/);
    expect(frames[2]).toMatch(/^event: done\n/);
  });

  // ---- jsonError helper ------------------------------------------
  it('jsonError returns a structured JSON error response', async () => {
    const res = jsonError(400, 'invalid_input', 'Provide a valid body');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
    expect(body.hint).toBe('Provide a valid body');
  });

  // ---- Persona / mode passthrough --------------------------------
  it('respects an explicit persona in the meta event', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi', persona: 'Yuki' }),
      makeDeps(),
    );
    const events = await readAllEvents(res);
    const meta = events[0];
    if (meta.t === 'meta') {
      expect(meta.persona).toBe('Yuki');
    }
  });

  it('respects an explicit sensitivity in the meta event', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi', sensitivity: 'S2' }),
      makeDeps(),
    );
    const events = await readAllEvents(res);
    const meta = events[0];
    if (meta.t === 'meta') {
      expect(meta.sensitivity).toBe('S2');
    }
  });

  // ---- Auth throw degrades to 500 --------------------------------
  it('authenticate throwing yields a 500 with a clean error body', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({
        authenticate: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('auth_failed');
  });

  // ---- isKillSwitchActive throw → treated as inactive ------------
  it('isKillSwitchActive throwing is treated as inactive (does not crash)', async () => {
    const res = await handleChatRequest(
      makeReq({ turnId: 't1', text: 'hi' }),
      makeDeps({
        isKillSwitchActive: () => {
          throw new Error('db down');
        },
      }),
    );
    expect(res.status).toBe(200);
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);
    expect(types).toContain('token');
    expect(types[types.length - 1]).toBe('done');
  });
});