// packages/orchestrator-core/test/orchestrator-core.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  runTurn,
  CLAIMS_PER_TIER,
} from '../src/index.js';
import type {
  TurnRequest,
  TurnDeps,
  VerificationResult,
} from '../src/index.js';
import { BreakerRegistry } from '@aura-lie/circuit-breaker';
import { QuotaLedger } from '@aura-lie/quota-ledger';
import type {
  ProviderAdapter,
  ProviderChatEvent,
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

function makeAdapter(
  events: ProviderChatEvent[],
  id: string,
): ProviderAdapter {
  return {
    id,
    lane: 'private',
    chat: async function* () {
      for (const e of events) yield e;
    },
  };
}

function okAdapter(id: string, text = 'ok'): ProviderAdapter {
  return makeAdapter(
    [
      { kind: 'content', delta: text },
      { kind: 'usage', promptTokens: 10, completionTokens: 2 },
      { kind: 'finish', reason: 'stop' },
    ],
    id,
  );
}

function makeReq(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turnId: 'turn-1',
    text: 'hi there',
    ...overrides,
  };
}

function eventsOfType<T extends string>(
  events: any[],
  type: T,
): any[] {
  return events.filter((e) => e.t === type);
}

// -----------------------------------------------------------------------------
describe('Orchestrator Core (PRD 7.1, 7.2, Appendix C, F-001)', () => {
  // ---- Constants ----------------------------------------------------
  it('CLAIMS_PER_TIER matches PRD 8.6 (0/3/6/8)', () => {
    expect(CLAIMS_PER_TIER[0]).toBe(0);
    expect(CLAIMS_PER_TIER[1]).toBe(3);
    expect(CLAIMS_PER_TIER[2]).toBe(6);
    expect(CLAIMS_PER_TIER[3]).toBe(8);
  });

  // ---- Happy path: instant / light --------------------------------
  it('instant turn: emits meta → token* → done (no verify)', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq', 'hello') },
      clock,
    });

    const types = result.events.map((e) => e.t);
    expect(types[0]).toBe('meta');
    expect(types[types.length - 1]).toBe('done');
    expect(types).toContain('token');
    expect(types.filter((t) => t === 'token').length).toBe(1);
    expect(result.winner).toBeDefined();
    expect(result.verification).toBeUndefined();
  });

  it('done event carries costInr = 0 (Law L1)', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    const done = result.events[result.events.length - 1];
    expect(done.t).toBe('done');
    if (done.t === 'done') {
      expect(done.costInr).toBe(0);
    }
  });

  it('meta event is present exactly once with correct turnId', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq({ turnId: 'abc' }), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    const metas = eventsOfType(result.events, 'meta');
    expect(metas.length).toBe(1);
    expect(metas[0].turnId).toBe('abc');
    expect(metas[0].v).toBe(1);
  });

  it('done event reports the tokens used', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    const done = result.events[result.events.length - 1];
    if (done.t === 'done') {
      expect(done.tokens).toBe(12); // 10 prompt + 2 completion
    }
  });

  // ---- Thinking comes through ------------------------------------
  it('reasoning events become thinking events in the output', async () => {
    const { clock } = fixedClock(1000);
    const adapter = makeAdapter(
      [
        { kind: 'reasoning', delta: 'Thinking…', provider: 'groq', model: 'm', format: 'summary' },
        { kind: 'content', delta: 'Answer.' },
        { kind: 'finish', reason: 'stop' },
      ],
      'groq',
    );
    const result = await runTurn(makeReq({ text: 'think carefully' }), {
      adapters: { groq: adapter },
      clock,
    });
    const thinking = eventsOfType(result.events, 'thinking');
    expect(thinking.length).toBe(1);
    expect(thinking[0].delta).toBe('Thinking…');
  });

  // ---- Verification path -----------------------------------------
  it('runs verification when riskTier >= 1 and verify is provided', async () => {
    const { clock } = fixedClock(1000);
    const verification: VerificationResult = {
      checked: 1,
      checkable: 1,
      claims: [
        {
          id: 'c1',
          text: 'The capital of France is Paris.',
          type: 'entity-relation',
          importance: 'central',
          score: 92,
          status: 'VERIFIED',
          factors: { S: 100, E: 100, A: 100, F: 100 },
          capsApplied: [],
          sources: [
            {
              id: 's1',
              title: 'Paris',
              domain: 'en.wikipedia.org',
              tier: 1,
              independenceGroup: 'wiki',
              quote: 'Paris is the capital of France',
              matchOk: true,
            },
          ],
        },
      ],
    };
    const verify = vi.fn(async () => verification);

    const result = await runTurn(
      makeReq({ text: 'What is the capital of France?' }),
      {
        adapters: { groq: okAdapter('groq') },
        verify,
        clock,
      },
    );

    expect(verify).toHaveBeenCalledOnce();
    expect(result.verification).toBeDefined();

    const types = result.events.map((e) => e.t);
    // Order: claim → source → quote → score → summary
    const claimIdx = types.indexOf('claim');
    const sourceIdx = types.indexOf('source');
    const quoteIdx = types.indexOf('quote');
    const scoreIdx = types.indexOf('score');
    const summaryIdx = types.indexOf('summary');
    expect(claimIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(quoteIdx);
    expect(quoteIdx).toBeLessThan(scoreIdx);
    expect(scoreIdx).toBeLessThan(summaryIdx);

    // Summary chip comes from truth package.
    const summary = result.events[summaryIdx];
    if (summary.t === 'summary') {
      expect(summary.checked).toBe(1);
      expect(summary.checkable).toBe(1);
      expect(summary.heuristic).toBe(true);
    }
  });

  it('does not run verification at tier 0 (chit-chat)', async () => {
    const { clock } = fixedClock(1000);
    const verify = vi.fn(async () => ({
      checked: 0,
      checkable: 0,
      claims: [],
    }));
    const result = await runTurn(makeReq({ text: 'hi' }), {
      adapters: { groq: okAdapter('groq') },
      verify,
      clock,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(result.verification).toBeUndefined();
  });

  it('verify errors do not fail the turn', async () => {
    const { clock } = fixedClock(1000);
    const verify = vi.fn(async () => {
      throw new Error('verify boom');
    });
    const result = await runTurn(
      makeReq({ text: 'What is 2+2?' }),
      {
        adapters: { groq: okAdapter('groq') },
        verify,
        clock,
      },
    );
    // Turn still completes.
    const types = result.events.map((e) => e.t);
    expect(types[types.length - 1]).toBe('done');
    // A trace notes the verify failure.
    expect(types).toContain('trace');
    const traces = eventsOfType(result.events, 'trace');
    expect(traces.some((t) => t.type === 'verify-error')).toBe(true);
  });

  // ---- Waterfall: T-14 through orchestrator ----------------------
  it('falls through to gemini when groq throws', async () => {
    const { clock } = fixedClock(1000);
    const groq: ProviderAdapter = {
      id: 'groq',
      lane: 'private',
      chat: async function* () {
        throw new Error('ECONNREFUSED');
      },
    };
    const gemini = okAdapter('gemini', 'from gemini');

    const result = await runTurn(makeReq(), {
      adapters: { groq, gemini },
      clock,
    });

    expect(result.winner?.family).toBe('gemini');
    // Did we get a token from gemini?
    const tokenEvents = eventsOfType(result.events, 'token');
    expect(tokenEvents.length).toBe(1);
    expect(tokenEvents[0].delta).toBe('from gemini');
  });

  it('all providers fail → error + done, no user-visible stack trace', async () => {
    const { clock } = fixedClock(1000);
    const groq: ProviderAdapter = {
      id: 'groq',
      lane: 'private',
      chat: async function* () {
        throw new Error('down');
      },
    };
    const result = await runTurn(makeReq(), {
      adapters: { groq },
      clock,
    });
    const types = result.events.map((e) => e.t);
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('done');
    const error = result.events.find((e) => e.t === 'error');
    if (error && error.t === 'error') {
      expect(error.code).toBe('all-providers-failed');
      // No stack trace leaks into the user message.
      expect(error.userMessage).not.toMatch(/at Object/);
    }
  });

  it('no adapters registered → error + done', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq(), {
      adapters: {},
      clock,
    });
    const types = result.events.map((e) => e.t);
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('done');
  });

  // ---- Breaker integration -------------------------------------
  it('skips a candidate whose breaker is open', async () => {
    const { clock } = fixedClock(1000);
    const breakers = new BreakerRegistry({}, clock);
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');
    breakers.recordFailure('groq');

    let groqCalled = false;
    const groq: ProviderAdapter = {
      id: 'groq',
      lane: 'private',
      chat: async function* () {
        groqCalled = true;
        yield { kind: 'content', delta: 'never' };
        yield { kind: 'finish', reason: 'stop' };
      },
    };
    const gemini = okAdapter('gemini');

    const result = await runTurn(makeReq(), {
      adapters: { groq, gemini },
      breakers,
      clock,
    });

    expect(groqCalled).toBe(false);
    expect(result.winner?.family).toBe('gemini');
  });

  // ---- Ledger integration --------------------------------------
  it('reserves and commits quota for the winning candidate', async () => {
    const { clock } = fixedClock(1000);
    const ledger = new QuotaLedger(
      [{ id: 'groq', seedLimit: 1000, resetHourUtc: 0 }],
      clock,
    );
    const reserveSpy = vi.spyOn(ledger, 'reserve');
    const commitSpy = vi.spyOn(ledger, 'commit');

    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      ledger,
      clock,
    });

    expect(reserveSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalled();
    // 12 tokens committed.
    expect(ledger.snapshot('groq')?.used).toBe(12);
    expect(result.winner?.family).toBe('groq');
  });

  it('skips a candidate whose quota is exhausted', async () => {
    const { clock } = fixedClock(1000);
    const ledger = new QuotaLedger(
      [{ id: 'groq', seedLimit: 10, resetHourUtc: 0 }], // planningLimit = 8
      clock,
    );
    // Exhaust it: reserve 8 directly.
    ledger.reserve('groq', 8, 'interactive');

    let groqCalled = false;
    const groq: ProviderAdapter = {
      id: 'groq',
      lane: 'private',
      chat: async function* () {
        groqCalled = true;
        yield { kind: 'content', delta: 'x' };
        yield { kind: 'finish', reason: 'stop' };
      },
    };
    const gemini = okAdapter('gemini');

    const result = await runTurn(makeReq(), {
      adapters: { groq, gemini },
      ledger,
      clock,
    });

    expect(groqCalled).toBe(false);
    expect(result.winner?.family).toBe('gemini');
  });

  // ---- Curation fires but never blocks ------------------------
  it('fires curation asynchronously without blocking', async () => {
    const { clock } = fixedClock(1000);
    const curate = vi.fn(() => Promise.resolve());

    await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      curate,
      clock,
    });

    // The call is fire-and-forget; a microtask later it must have run.
    await Promise.resolve();
    await Promise.resolve();
    expect(curate).toHaveBeenCalled();
  });

  it('curate errors do not crash the turn', async () => {
    const { clock } = fixedClock(1000);
    const curate = vi.fn(() => {
      throw new Error('curate boom');
    });

    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      curate,
      clock,
    });

    const types = result.events.map((e) => e.t);
    expect(types[types.length - 1]).toBe('done');
  });

  // ---- Council out-of-scope -----------------------------------
  it('council mode returns a clear error (not a crash)', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq({ mode: 'council' }), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    const types = result.events.map((e) => e.t);
    expect(types[0]).toBe('meta');
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('done');
    const err = result.events.find((e) => e.t === 'error');
    if (err && err.t === 'error') {
      expect(err.code).toBe('council-not-supported');
    }
  });

  // ---- Event order integrity ---------------------------------
  it('meta is always first, done is always last', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq({ text: 'What is 2+2?' }), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    const types = result.events.map((e) => e.t);
    expect(types[0]).toBe('meta');
    expect(types[types.length - 1]).toBe('done');
  });

  it('trace events have monotonically increasing seq', async () => {
    const { clock, add } = fixedClock(1000);
    const adapter = makeAdapter(
      [
        { kind: 'content', delta: 'a' },
        { kind: 'finish', reason: 'stop' },
      ],
      'groq',
    );
    const result = await runTurn(makeReq(), {
      adapters: { groq: adapter },
      clock,
    });
    const traces = eventsOfType(result.events, 'trace');
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i].seq).toBeGreaterThan(traces[i - 1].seq);
    }
  });

  // ---- Persona passthrough -----------------------------------
  it('respects an explicit persona in the meta event', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(
      makeReq({ persona: 'Yuki' }),
      {
        adapters: { groq: okAdapter('groq') },
        clock,
      },
    );
    const meta = result.events[0];
    if (meta.t === 'meta') {
      expect(meta.persona).toBe('Yuki');
    }
  });

  // ---- Sensitivity + risk override ---------------------------
  it('respects an explicit sensitivity override', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(
      makeReq({ text: 'hi', sensitivity: 'S2' }),
      {
        adapters: { groq: okAdapter('groq') },
        clock,
      },
    );
    const meta = result.events[0];
    if (meta.t === 'meta') {
      expect(meta.sensitivity).toBe('S2');
    }
  });

  // ---- Bytes accounting --------------------------------------
  it('returns bytesOut greater than 0 on success', async () => {
    const { clock } = fixedClock(1000);
    const result = await runTurn(makeReq(), {
      adapters: { groq: okAdapter('groq') },
      clock,
    });
    expect(result.bytesOut).toBeGreaterThan(0);
  });
});