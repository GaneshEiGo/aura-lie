// === FILE START ===
// packages/agents/test/sdk-js-v2.test.ts
// PRD §14.6 · FR-DEV-05.

import { describe, it, expect } from 'vitest';
import {
  AuraClient,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '../src/sdk-js-v2.js';

function mockTransport(
  responder: (req: TransportRequest) => unknown,
): { transport: Transport; calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  const transport: Transport = {
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      calls.push(req);
      return { status: 200, body: responder(req) as T };
    },
  };
  return { transport, calls };
}

describe('sdk — construction', () => {
  it('rejects an empty bearer token', () => {
    expect(() =>
      new AuraClient({ bearerToken: '', transport: mockTransport(() => ({})) .transport }),
    ).toThrow();
  });

  it('accepts a non-empty bearer token', () => {
    const { transport } = mockTransport(() => ({}));
    expect(() => new AuraClient({ bearerToken: 'tok', transport })).not.toThrow();
  });
});

describe('sdk — health', () => {
  it('calls GET /health with no bearer token', async () => {
    const { transport, calls } = mockTransport(() => ({ status: 'ok' }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    const r = await client.health();
    expect(r.status).toBe('ok');
    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.path).toBe('/health');
    expect(calls[0]!.bearerToken).toBeNull();
  });
});

describe('sdk — chat', () => {
  it('rejects an empty message locally without calling the transport', async () => {
    const { transport, calls } = mockTransport(() => ({}));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    await expect(client.chat({ message: '' })).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it('POSTs /v1/chat with the bearer token and the body', async () => {
    const { transport, calls } = mockTransport(() => ({
      id: 't1', answer: 'ok', claims: 0, costInr: 0,
    }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    const r = await client.chat({ message: 'hello' });
    expect(r.id).toBe('t1');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/v1/chat');
    expect(calls[0]!.bearerToken).toBe('tok');
    expect(calls[0]!.body).toEqual({ message: 'hello' });
  });
});

describe('sdk — memory', () => {
  it('createMemory rejects empty text locally', async () => {
    const { transport, calls } = mockTransport(() => ({}));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    await expect(client.createMemory({ text: '', sensitivity: 'S0' })).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it('forgetMemory calls DELETE /v1/memory/:id', async () => {
    const { transport, calls } = mockTransport(() => ({ id: 'm1', forgotten: true }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    const r = await client.forgetMemory('m1');
    expect(r.forgotten).toBe(true);
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.path).toBe('/v1/memory/m1');
  });

  it('listMemory calls GET /v1/memory', async () => {
    const { transport, calls } = mockTransport(() => ({ items: [], nextCursor: null }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    await client.listMemory();
    expect(calls[0]!.path).toBe('/v1/memory');
  });
});

describe('sdk — missions', () => {
  it('createMission rejects an empty goal locally', async () => {
    const { transport, calls } = mockTransport(() => ({}));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    await expect(client.createMission({ goal: '', tasks: [] })).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it('getMission calls GET /v1/missions/:id', async () => {
    const { transport, calls } = mockTransport(() => ({
      id: 'm1', cursor: 0, totalSteps: 3, stopped: null,
    }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    const r = await client.getMission('m1');
    expect(r.id).toBe('m1');
    expect(calls[0]!.path).toBe('/v1/missions/m1');
  });
});

describe('sdk — quota and receipt', () => {
  it('quota calls GET /v1/quota', async () => {
    const { transport, calls } = mockTransport(() => ({ pools: [] }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    await client.quota();
    expect(calls[0]!.path).toBe('/v1/quota');
  });

  it('receipt calls GET /v1/receipt', async () => {
    const { transport, calls } = mockTransport(() => ({
      month: '2026-10', replies: 0, costInr: 0,
    }));
    const client = new AuraClient({ bearerToken: 'tok', transport });
    const r = await client.receipt();
    expect(r.costInr).toBe(0);
    expect(calls[0]!.path).toBe('/v1/receipt');
  });
});

describe('sdk — source scan', () => {
  it('source scan: sdk-js-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'sdk-js-v2.ts'),
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