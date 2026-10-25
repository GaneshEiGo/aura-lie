// apps/edge/test/edge-verification.test.ts
// End-to-end proof that the truth pipeline runs inside /v1/chat.

import { describe, it, expect } from 'vitest';
import { createEdgeApp } from '../src/app.js';
import { createChatHandlerDeps } from '../src/deps.js';
import type { ChatEvent, ProviderAdapter } from '@aura-lie/stream-proxy';
import { verifyTurn } from '@aura-lie/truth-pipeline';
import type { VerificationInput } from '@aura-lie/truth-pipeline';
import {
  SearchBroker,
  SearchLedger,
  VerifyLaterQueue,
  DEFAULT_POOLS,
} from '@aura-lie/search-broker';
import type {
  SearchProvider,
  SourceResult,
  PoolId,
  Clock as BrokerClock,
} from '@aura-lie/search-broker';
import type { Candidate } from '@aura-lie/circuit-breaker';
import { BreakerRegistry } from '@aura-lie/circuit-breaker';
import { QuotaLedger } from '@aura-lie/quota-ledger';
import { KillSwitch } from '@aura-lie/kill-switch-audit';
import { ToolRegistry } from '@aura-lie/permission-tools';
import { builtinExecutors } from '@aura-lie/tools-runner';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function factualAdapter(id = 'groq'): ProviderAdapter {
  return {
    id,
    lane: 'private',
    async *chat() {
      yield {
        kind: 'content',
        delta: 'Paris is the capital of France.',
      };
      yield { kind: 'usage', promptTokens: 8, completionTokens: 6 };
      yield { kind: 'finish', reason: 'stop' };
    },
  };
}

function plainAdapter(id = 'cerebras'): ProviderAdapter {
  return {
    id,
    lane: 'private',
    async *chat() {
      yield { kind: 'content', delta: 'Hello.' };
      yield { kind: 'usage', promptTokens: 4, completionTokens: 1 };
      yield { kind: 'finish', reason: 'stop' };
    },
  };
}

function makeSearchProvider(): SearchProvider {
  return {
    async search(poolId: PoolId, _query: string): Promise<SourceResult | null> {
      if (poolId === 'wikipedia') {
        return {
          poolId,
          url: 'https://en.wikipedia.org/wiki/Paris',
          title: 'Paris',
          snippet: 'Paris is the capital of France.',
        };
      }
      return null;
    },
  };
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

interface MakeAppOptions {
  withVerification?: boolean;
}

function makeApp(options: MakeAppOptions = {}): {
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
      { id: 'cerebras', seedLimit: 330, resetHourUtc: 0 },
      { id: 'workers-ai', seedLimit: 10000, resetHourUtc: 0 },
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

  const brokerClock: BrokerClock = clock;
  const brokerLedger = new SearchLedger(DEFAULT_POOLS, brokerClock);
  const broker = new SearchBroker(
    makeSearchProvider(),
    brokerLedger,
    new VerifyLaterQueue(),
  );

  const judgeCandidates: Candidate[] = [
    { family: 'gemini', model: 'gemini-2-flash', role: 'judge' },
    { family: 'cerebras', model: 'llama-3.1-8b', role: 'judge' },
  ];

  const judgeFn = async (
    _candidate: Candidate,
    claim: string,
    passage: string,
  ) => {
    if (passage.includes('Paris') && claim.includes('Paris')) {
      return {
        stance: 'supports' as const,
        quote: 'Paris is the capital of France.',
        rationale: 'explicit',
      };
    }
    return { stance: 'neutral' as const, quote: '', rationale: 'no match' };
  };

  const verify = options.withVerification
    ? (input: VerificationInput) =>
        verifyTurn(input, {
          broker,
          judgeCandidates,
          judgeFn,
          drafterFamily: 'groq',
          clock,
        })
    : undefined;

  const deps = createChatHandlerDeps({
    adapters: {
      groq: factualAdapter('groq'),
      gemini: plainAdapter('gemini'),
      cerebras: plainAdapter('cerebras'),
      'workers-ai': plainAdapter('workers-ai'),
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
    verify,
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

function chatRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

// -----------------------------------------------------------------------------
describe('Edge verification wiring (Sections 58 + 66)', () => {
  it('without verify, only token + done events appear', async () => {
    const { app } = makeApp({ withVerification: false });
    const res = await app(
      chatRequest({ turnId: 't1', text: 'What is the capital of France?' }),
    );
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);
    expect(types).toContain('token');
    expect(types).not.toContain('claim');
    expect(types).not.toContain('source');
    expect(types).not.toContain('summary');
  });

  it('with verify, claim/source/quote/score/summary events appear', async () => {
    const { app } = makeApp({ withVerification: true });
    const res = await app(
      chatRequest({ turnId: 't1', text: 'What is the capital of France?' }),
    );
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);

    expect(types).toContain('claim');
    expect(types).toContain('source');
    expect(types).toContain('quote');
    expect(types).toContain('score');
    expect(types).toContain('summary');
    expect(types[types.length - 1]).toBe('done');
  });

  it('summary event carries heuristic: true and checked count', async () => {
    const { app } = makeApp({ withVerification: true });
    const res = await app(
      chatRequest({ turnId: 't1', text: 'What is the capital of France?' }),
    );
    const events = await readAllEvents(res);
    const summary = events.find((e) => e.t === 'summary');
    expect(summary).toBeDefined();
    if (summary && summary.t === 'summary') {
      expect(summary.heuristic).toBe(true);
      expect(summary.checked).toBeGreaterThanOrEqual(1);
      expect(summary.checkable).toBeGreaterThanOrEqual(1);
    }
  });

  it('score event reflects a verified claim with quote matched', async () => {
    const { app } = makeApp({ withVerification: true });
    const res = await app(
      chatRequest({ turnId: 't1', text: 'What is the capital of France?' }),
    );
    const events = await readAllEvents(res);
    const score = events.find((e) => e.t === 'score');
    expect(score).toBeDefined();
    if (score && score.t === 'score') {
      expect(score.score).not.toBeNull();
      expect(score.status).toBe('VERIFIED');
    }
  });

  it('event order is claim → source → quote → score → summary', async () => {
    const { app } = makeApp({ withVerification: true });
    const res = await app(
      chatRequest({ turnId: 't1', text: 'What is the capital of France?' }),
    );
    const events = await readAllEvents(res);
    const idx = (t: string) => events.findIndex((e) => e.t === t);
    expect(idx('claim')).toBeLessThan(idx('source'));
    expect(idx('source')).toBeLessThan(idx('quote'));
    expect(idx('quote')).toBeLessThan(idx('score'));
    expect(idx('score')).toBeLessThan(idx('summary'));
  });

  it('tier-0 chit-chat skips verification but still streams and closes', async () => {
    const { app } = makeApp({ withVerification: true });
    const res = await app(chatRequest({ turnId: 't1', text: 'hi' }));
    const events = await readAllEvents(res);
    const types = events.map((e) => e.t);
    expect(types).toContain('token');
    expect(types).not.toContain('claim');
    expect(types).not.toContain('summary');
    expect(types[types.length - 1]).toBe('done');
  });
});