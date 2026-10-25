// === FILE START ===
// packages/agents/test/handler-v2.test.ts
// PRD §13.1 · §12.6 · §12.7 · §10.10.

import { describe, it, expect } from 'vitest';
import { handle } from '../src/handler-v2.js';

function req(
  method: string,
  path: string,
  opts: { bearer?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://aura-lie.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const env = {
  BEARER_TOKEN: 'secret',
  KILL_SWITCH: 'inactive',
  PROVIDER_NAME: 'groq',
};

describe('handler — /health', () => {
  it('GET /health is public and returns 200', async () => {
    const res = await handle(req('GET', '/health'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /health still returns 200 when the kill switch is active', async () => {
    const res = await handle(req('GET', '/health'), {
      ...env,
      KILL_SWITCH: 'active',
    });
    expect(res.status).toBe(200);
  });
});

describe('handler — auth', () => {
  it('POST /v1/chat without auth returns 401', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { body: { message: 'hi' } }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/chat with a wrong token returns 401', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'wrong', body: { message: 'hi' } }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/chat with no BEARER_TOKEN configured returns 401', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: 'hi' } }),
      { ...env, BEARER_TOKEN: '' },
    );
    expect(res.status).toBe(401);
  });
});

describe('handler — kill switch', () => {
  it('POST /v1/chat with the kill switch active returns 200 with a notice body', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: 'hi' } }),
      { ...env, KILL_SWITCH: 'active' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('kill_switch_active');
  });
});

describe('handler — /v1/chat body validation', () => {
  it('rejects an empty message with 400', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: '' } }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a missing message with 400', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a body that is not JSON with 400', async () => {
    const r = new Request('https://aura-lie.test/v1/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: 'not json',
    });
    const res = await handle(r, env);
    expect(res.status).toBe(400);
  });
});

describe('handler — /v1/chat without a provider', () => {
  it('returns 503 with a clear message naming provider env vars', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: 'hi' } }),
      { ...env, PROVIDER_NAME: '' },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('no_provider');
    expect(body.message).toContain('GROQ_API_KEY');
    expect(body.message).toContain('Workers AI');
  });
});

describe('handler — /v1/chat with a provider', () => {
  it('returns 200 with the demo reply shape', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: 'hi' } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      answer: string;
      claims: number;
      costInr: number;
      provider: string;
    };
    expect(body.provider).toBe('groq');
    expect(body.costInr).toBe(0);
    expect(body.claims).toBe(0);
    expect(body.answer.length).toBeGreaterThan(0);
  });

  it('a HandlerOptions.providerName overrides the env var', async () => {
    const res = await handle(
      req('POST', '/v1/chat', { bearer: 'secret', body: { message: 'hi' } }),
      { ...env, PROVIDER_NAME: '' },
      { providerName: 'gemini' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string };
    expect(body.provider).toBe('gemini');
  });
});

describe('handler — unknown and unwired routes', () => {
  it('returns 404 for a path that is not in the manifest', async () => {
    const res = await handle(req('GET', '/not-a-route'), env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('returns 501 with the manifest entry for a manifest route with no wiring yet', async () => {
    const res = await handle(
      req('GET', '/v1/memory', { bearer: 'secret' }),
      env,
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as {
      error: string;
      manifest: string;
      route: string;
    };
    expect(body.error).toBe('not_implemented');
    expect(body.manifest).toBe('MemoryList');
    expect(body.route).toBe('GET /v1/memory');
  });
});
// === FILE END ===