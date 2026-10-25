// apps/edge/test/edge-assembled.test.ts
// Proves the fully-assembled Worker pipeline end-to-end. The 4 W1 tests in
// edge.test.ts are unaffected — this file adds a new layer above them.

import { describe, it, expect } from 'vitest';
import { createEdgeApp } from '../src/app.js';
import { createChatHandlerDeps } from '../src/deps.js';
import { createMockAdapter } from '../src/adapters/index.js';
import type { ChatEvent } from '@aura-lie/stream-proxy';
import { BreakerRegistry } from '@aura-lie/circuit-breaker';
import { QuotaLedger } from '@aura-lie/quota-ledger';
import { KillSwitch } from '@aura-lie/kill-switch-audit';
import { ToolRegistry } from '@aura-lie/permission-tools';
import { builtinExecutors } from '@aura-lie/tools-runner';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeApp(overrides: any = {}): {
  app: (req: Request) => Promise<Response>;
  killSwitch: KillSwitch;
  ledger: QuotaLedger;
} {
  const clock = { now: () => 1000 };
  const killSwitch = new KillSwitch({ clock });
  const ledger = new QuotaLedger(
    [
      { id: 'groq', seedLimit: 1000, resetHourUtc: 0 },
      { id: 'gemini', seedLimit: 500, resetHourUtc: 0 },
    ],
    clock,
  );
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    id: 'echo',
    description: 'echoes input',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['read:web'],
    risk: 'low',
    quotaPool: null,
    timeoutMs: 5000,
    maxOutputBytes: 10000,
    tainting: 'none',
  });
  toolRegistry.register({
    id: 'calculator',
    description: 'calculates',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['read:web'],
    risk: 'none',
    quotaPool: null,
    timeoutMs: 5000,
    maxOutputBytes: 10000,
    tainting: 'none',
  });

  const deps = createChatHandlerDeps({
    adapters: {
      groq: createMockAdapter({ id: 'groq' }),
      gemini: createMockAdapter({ id: 'gemini' }),
      cerebras: createMockAdapter({ id: 'cerebras' }),
      'workers-ai': createMockAdapter({ id: 'workers-ai' }),
    },
    authenticate: (req) => {
      const header = req.headers.get('authorization');
      if (header !== 'Bearer test-token') return null;
      return { userId: 'test-user' };
    },
    isKillSwitchActive: () => killSwitch.isActive(),
    clock,
    ledger,
    breakers: new BreakerRegistry({}, clock),
    ...overrides,
  });

  return {
    app: createEdgeApp({
      ...deps,
      killSwitch,
      quotaLedger: ledger,
      toolRegistry,
      toolExecutors: builtinExecutors,
    }),
    killSwitch,
    ledger,
  };
}

function chatRequest(
  body: Record<string, unknown>,
  auth: boolean = true,
): Request {
  return new Request('http://localhost/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer test-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readAllEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  const frames = text.split('\n\n').filter((s) => s.trim());
  const events: ChatEvent[] = [];
  for (const frame of frames) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    if (dataLine) {
      try {
        events.push(JSON.parse(dataLine.slice(6)));
      } catch {
        /* skip */
      }
    }
  }
  return events;
}

// -----------------------------------------------------------------------------
describe('apps/edge assembled (Sections 58-63)', () => {
  // ---- /health --------------------------------------------------
  it('/health is public and returns 200', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/health', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  // ---- /v1/chat: auth ------------------------------------------
  it('/v1/chat rejects requests without auth', async () => {
    const { app } = makeApp();
    const res = await app(
      chatRequest({ turnId: 't1', text: 'hi' }, false),
    );
    expect(res.status).toBe(401);
  });

  it('/v1/chat rejects requests with a bad token', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token',
        },
        body: JSON.stringify({ turnId: 't1', text: 'hi' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  // ---- /v1/chat: kill switch -----------------------------------
  it('/v1/chat with kill switch returns meta + notice + done SSE', async () => {
    const { app, killSwitch } = makeApp();
    await killSwitch.pause('test-user', 'manual');

    const res = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readAllEvents(res);
    expect(events.map((e) => e.t)).toEqual(['meta', 'notice', 'done']);
    const notice = events[1];
    if (notice.t === 'notice') {
      expect(notice.code).toBe('kill-switch');
    }
  });

  // ---- /v1/chat: happy path ------------------------------------
  it('/v1/chat streams meta → tokens → done', async () => {
    const { app } = makeApp();
    const res = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readAllEvents(res);
    expect(events[0].t).toBe('meta');
    expect(events[events.length - 1].t).toBe('done');
    const tokens = events.filter((e) => e.t === 'token');
    expect(tokens.length).toBeGreaterThan(0);
    const done = events[events.length - 1];
    if (done.t === 'done') {
      expect(done.costInr).toBe(0);
    }
  });

  it('/v1/chat does not stream when kill switch is active', async () => {
    const { app, killSwitch } = makeApp();
    await killSwitch.pause('test-user', 'manual');
    const res = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    const events = await readAllEvents(res);
    expect(events.some((e) => e.t === 'token')).toBe(false);
  });

  // ---- /v1/pause + /v1/resume ---------------------------------
  it('/v1/pause toggles the kill switch', async () => {
    const { app, killSwitch } = makeApp();
    expect(killSwitch.isActive()).toBe(false);
    const res = await app(
      new Request('http://localhost/v1/pause', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ reason: 'test' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(killSwitch.isActive()).toBe(true);
  });

  it('/v1/resume clears the kill switch', async () => {
    const { app, killSwitch } = makeApp();
    await killSwitch.pause('test-user', 'manual');
    expect(killSwitch.isActive()).toBe(true);
    const res = await app(
      new Request('http://localhost/v1/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ reason: 'resume' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(killSwitch.isActive()).toBe(false);
  });

  it('/v1/pause requires authentication', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/pause', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  // ---- /v1/quota -----------------------------------------------
  it('/v1/quota returns pool snapshots', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/quota', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pools)).toBe(true);
    expect(body.pools.length).toBeGreaterThan(0);
    // Each pool has the Appendix C shape.
    for (const pool of body.pools) {
      expect(typeof pool.pool).toBe('string');
      expect(typeof pool.used).toBe('number');
      expect(typeof pool.planningLimit).toBe('number');
      expect(typeof pool.resetsAt).toBe('string');
    }
  });

  it('/v1/quota requires authentication', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/quota', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });

  // ---- /v1/tools/:id -------------------------------------------
  it('/v1/tools/echo executes and returns fenced output', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/tools/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ input: 'hello' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.fencedOutput).toBe('"hello"');
  });

  it('/v1/tools/calculator runs arithmetic', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/tools/calculator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ input: { op: '*', a: 7, b: 6 } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.fencedOutput).toBe('42');
  });

  it('/v1/tools/echo requires authentication', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/tools/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hi' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('/v1/tools/:id rejects unknown tools', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/v1/tools/ghost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ input: 'x' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.error).toMatch(/unknown tool/);
  });

  // ---- Unknown routes -----------------------------------------
  it('returns 404 for unknown routes', async () => {
    const { app } = makeApp();
    const res = await app(
      new Request('http://localhost/nowhere', { method: 'GET' }),
    );
    expect(res.status).toBe(404);
  });

  // ---- E2E: full pipeline with quota accounting ---------------
  it('E2E: /v1/chat consumes quota for the winning candidate', async () => {
    const { app, ledger } = makeApp();
    const before = ledger.snapshotAll();
    const res = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    await readAllEvents(res);
    const after = ledger.snapshotAll();
    // Some pool's `used` increased.
    const usedIncreased = after.some((pool) => {
      const before_pool = before.find((p) => p.pool === pool.pool);
      return before_pool ? pool.used > before_pool.used : false;
    });
    expect(usedIncreased).toBe(true);
  });

  it('E2E: pause halts the very next chat request', async () => {
    const { app } = makeApp();
    // Baseline: chat works.
    const ok = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    const okEvents = await readAllEvents(ok);
    expect(okEvents.some((e) => e.t === 'token')).toBe(true);

    // Pause.
    await app(
      new Request('http://localhost/v1/pause', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ reason: 'pause now' }),
      }),
    );

    // Next chat is halted.
    const halted = await app(chatRequest({ turnId: 't2', text: 'hi' }));
    const haltedEvents = await readAllEvents(halted);
    expect(haltedEvents.some((e) => e.t === 'token')).toBe(false);
    expect(haltedEvents.some((e) => e.t === 'notice')).toBe(true);
  });
});