// packages/search-broker/test/search-broker.test.ts
import { describe, it, expect } from 'vitest';
import {
  SearchBroker,
  SearchLedger,
  VerifyLaterQueue,
  DEFAULT_POOLS,
  routePools,
  looksLikePii,
} from '../src/index.js';
import type {
  BrokerClaim,
  Clock,
  PoolId,
  PoolConfig,
  SearchProvider,
  SourceResult,
} from '../src/types.js';

// ---- Fake clock -------------------------------------------------------------
function fixedClock(at: number): {
  clock: Clock;
  set: (t: number) => void;
  add: (d: number) => void;
  get: () => number;
} {
  let current = at;
  return {
    clock: { now: () => current },
    set: (t: number) => {
      current = t;
    },
    add: (d: number) => {
      current += d;
    },
    get: () => current,
  };
}

// ---- Mock provider ----------------------------------------------------------
class MockProvider implements SearchProvider {
  private responses = new Map<PoolId, SourceResult | null>();
  private throws = new Map<PoolId, Error>();
  public calls: Array<{ poolId: PoolId; query: string }> = [];

  set(poolId: PoolId, result: SourceResult | null): void {
    this.responses.set(poolId, result);
  }
  setThrow(poolId: PoolId, err: Error): void {
    this.throws.set(poolId, err);
  }
  async search(poolId: PoolId, query: string): Promise<SourceResult | null> {
    this.calls.push({ poolId, query });
    const t = this.throws.get(poolId);
    if (t) throw t;
    return this.responses.get(poolId) ?? null;
  }
}

function makeClaim(overrides: Partial<BrokerClaim> = {}): BrokerClaim {
  return {
    claimId: 'c1',
    text: 'The Q3 2027 date appears in the company release.',
    kind: 'general',
    riskTier: 1,
    sensitivity: 'S0',
    ...overrides,
  };
}

function makeLedger(clock: Clock, configs: PoolConfig[] = DEFAULT_POOLS): SearchLedger {
  return new SearchLedger(configs, clock);
}

/**
 * Tavily has a monthly reserve (300 until day 25) that we want to test
 * in isolation. The default config also has a 25/day soft cap which
 * prevents reserving 700 in a single calendar day. For the two reserve
 * tests, we strip the Tavily daily limit so we can reserve the full
 * pre-day-25 allowance (1000 - 300 = 700) directly.
 */
function poolsWithoutTavilyDailyCap(): PoolConfig[] {
  return DEFAULT_POOLS.map((p) =>
    p.id === 'tavily'
      ? { ...p, dailyLimit: undefined }
      : p,
  );
}

// -----------------------------------------------------------------------------
describe('Search Broker (PRD 8.5, 8.6, 12.3, F-032)', () => {
  // ---- Routing ------------------------------------------------------------
  it('routes definition claims through Wikipedia first', () => {
    const pools = routePools(makeClaim({ kind: 'definition', riskTier: 2 }));
    expect(pools[0]).toBe('wikipedia');
  });

  it('routes science claims through arXiv first', () => {
    const pools = routePools(makeClaim({ kind: 'science', riskTier: 2 }));
    expect(pools[0]).toBe('arxiv');
  });

  it('routes high-risk claims through Tavily first', () => {
    const pools = routePools(makeClaim({ kind: 'high-risk', riskTier: 3 }));
    expect(pools[0]).toBe('tavily');
  });

  it('routes tier-3 general claims through Tavily first', () => {
    const pools = routePools(makeClaim({ kind: 'general', riskTier: 3 }));
    expect(pools[0]).toBe('tavily');
  });

  it('returns no pools for tier 0', () => {
    const pools = routePools(makeClaim({ riskTier: 0 }));
    expect(pools).toEqual([]);
  });

  // ---- Tier 0 ------------------------------------------------------------
  it('tier-0 claims are skipped and cost nothing', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(makeClaim({ riskTier: 0 }));
    expect(outcome.status).toBe('skipped-tier-0');
    expect(provider.calls.length).toBe(0);
  });

  // ---- Happy path --------------------------------------------------------
  it('finds a Wikipedia source for a definition claim', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    provider.set('wikipedia', {
      poolId: 'wikipedia',
      url: 'https://en.wikipedia.org/wiki/Q3',
      title: 'Q3',
    });
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(makeClaim({ kind: 'definition' }));
    expect(outcome.status).toBe('verified');
    expect(outcome.sources.length).toBe(1);
    expect(outcome.poolsTried[0]).toBe('wikipedia');
  });

  // ---- Fallback ----------------------------------------------------------
  it('falls back to the next pool when the first returns empty', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    provider.set('wikipedia', null);
    provider.set('wikidata', { poolId: 'wikidata', url: 'https://wikidata.org/q1' });
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(makeClaim({ kind: 'definition' }));
    expect(outcome.status).toBe('verified');
    expect(outcome.poolsTried).toEqual(['wikipedia', 'wikidata']);
  });

  // ---- Unverified (checked, nothing found) -------------------------------
  it('reports unverified when every pool returns empty', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider(); // returns null everywhere
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(makeClaim({ kind: 'entity', riskTier: 1 }));
    expect(outcome.status).toBe('unverified');
    expect(outcome.attempts.every((a) => a.outcome === 'empty')).toBe(true);
  });

  // ---- Serper burn-down reserve ------------------------------------------
  it('uses Serper only after earlier pools are empty', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    provider.set('serper', { poolId: 'serper', url: 'https://serper.example/q' });
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(makeClaim({ kind: 'general', riskTier: 2 }));
    expect(outcome.status).toBe('verified');
    expect(outcome.sources[0].poolId).toBe('serper');
    const order = provider.calls.map((c) => c.poolId);
    expect(order).toEqual(['wikipedia', 'gemini-grounding', 'exa', 'serper']);
  });

  // ---- S2 consent gate ---------------------------------------------------
  it('S2 without consent returns consent-required', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(
      makeClaim({ sensitivity: 'S2', userApprovedExternalSearch: false }),
    );
    expect(outcome.status).toBe('consent-required');
    expect(provider.calls.length).toBe(0);
  });

  it('S2 with consent proceeds normally', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    provider.set('wikipedia', { poolId: 'wikipedia', url: 'https://wiki/q' });
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(
      makeClaim({
        sensitivity: 'S2',
        userApprovedExternalSearch: true,
        kind: 'definition',
      }),
    );
    expect(outcome.status).toBe('verified');
  });

  // ---- PII defense-in-depth ----------------------------------------------
  it('blocks external search when PII is present without consent', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(
      makeClaim({ text: 'contact me at jane@example.com about the release' }),
    );
    expect(outcome.status).toBe('consent-required');
    expect(provider.calls.length).toBe(0);
  });

  it('allows external search with PII when consent is given', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const provider = new MockProvider();
    provider.set('wikipedia', { poolId: 'wikipedia', url: 'https://wiki/q' });
    const broker = new SearchBroker(provider, makeLedger(clock));
    const outcome = await broker.verify(
      makeClaim({
        text: 'jane@example.com',
        userApprovedExternalSearch: true,
        kind: 'definition',
      }),
    );
    expect(outcome.status).toBe('verified');
  });

  it('looksLikePii detects email, Indian mobile, card', () => {
    expect(looksLikePii('mail me at a@b.co')).toBe(true);
    expect(looksLikePii('call 9876543210')).toBe(true);
    expect(looksLikePii('card 4111 1111 1111 1111')).toBe(true);
    expect(looksLikePii('the year 2026 was eventful')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Tavily monthly reserve — PRD 8.5: "never below a 300-credit reserve
  // until day 25". Starting Oct 20 (day 20), the usable allowance is
  // 1000 - 300 = 700 credits. Reserving 700 in a single day is only
  // possible if the *daily* soft cap is not enforced, so this test uses
  // a variant of the pool config with the Tavily daily cap removed.
  // ---------------------------------------------------------------------------
  it('Tavily reserve blocks before day 25', () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock, poolsWithoutTavilyDailyCap());

    // Consume exactly 700 credits — the max usable before day 25.
    for (let i = 0; i < 700; i++) {
      const r = ledger.tryReserve('tavily', 1);
      expect(r.ok).toBe(true);
    }
    const blocked = ledger.tryReserve('tavily', 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('monthly-reserve');
  });

  it('Tavily reserve lifts on day 25', () => {
    const { clock, set } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock, poolsWithoutTavilyDailyCap());

    for (let i = 0; i < 700; i++) ledger.tryReserve('tavily', 1);

    // Advance to Oct 26 (day 26 > 25) → reserve lifts.
    set(new Date(2026, 9, 26, 12).getTime());
    const allowed = ledger.tryReserve('tavily', 1);
    expect(allowed.ok).toBe(true);
  });

  // ---- Serper total budget ----------------------------------------------
  it('Serper one-time budget exhausts at 2,500', () => {
    // Force daily rollover by advancing one day between each batch of 10.
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock);

    let consumed = 0;
    for (let day = 0; day < 300 && consumed < 2500; day++) {
      for (let i = 0; i < 10 && consumed < 2500; i++) {
        const r = ledger.tryReserve('serper', 1);
        if (r.ok) consumed++;
        else break;
      }
      add(24 * 60 * 60 * 1000);
    }

    expect(consumed).toBe(2500);
    add(24 * 60 * 60 * 1000);
    const blocked = ledger.tryReserve('serper', 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('total-exhausted');
  });

  // ---- Jina throttle ----------------------------------------------------
  it('Jina Reader is throttled at 20 per minute', () => {
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock);

    for (let i = 0; i < 20; i++) {
      const r = ledger.tryReserve('jina', 1);
      expect(r.ok).toBe(true);
    }
    const blocked = ledger.tryReserve('jina', 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('throttled');

    add(61_000);
    const allowed = ledger.tryReserve('jina', 1);
    expect(allowed.ok).toBe(true);
  });

  // ---- Daily reset ------------------------------------------------------
  it('daily caps reset at midnight', () => {
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 23, 55).getTime());
    const ledger = makeLedger(clock);

    // Gemini 150/day
    for (let i = 0; i < 150; i++) {
      expect(ledger.tryReserve('gemini-grounding', 1).ok).toBe(true);
    }
    expect(ledger.tryReserve('gemini-grounding', 1).ok).toBe(false);

    add(10 * 60 * 1000); // past midnight
    expect(ledger.tryReserve('gemini-grounding', 1).ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Recall-only path — a claim whose entire route can be exhausted.
  // `high-risk` routes through ['tavily','exa','gemini-grounding','serper'],
  // with no Wikipedia in the chain, so exhausting Tavily/Exa/Gemini/Serper
  // leaves the claim with no pool to try.
  // ---------------------------------------------------------------------------
  it('returns recall-only and enqueues when every pool is quota-blocked', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock, poolsWithoutTavilyDailyCap());

    // Exhaust every pool the high-risk route would try.
    for (let i = 0; i < 700; i++) ledger.tryReserve('tavily', 1);
    for (let i = 0; i < 25; i++) ledger.tryReserve('exa', 1);
    for (let i = 0; i < 150; i++) ledger.tryReserve('gemini-grounding', 1);
    for (let i = 0; i < 10; i++) ledger.tryReserve('serper', 1);

    const provider = new MockProvider();
    const broker = new SearchBroker(provider, ledger);

    const outcome = await broker.verify(
      makeClaim({ kind: 'high-risk', riskTier: 3 }),
    );
    expect(outcome.status).toBe('recall-only');
    expect(outcome.reason).toBe('quota-exhausted');
    expect(broker.peekQueueSize()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // PRD 5.13 partial message — a mix of verifiable + recall-only claims.
  // Definition claims route through Wikipedia (open). High-risk claims
  // route through the exhausted pool chain.
  // ---------------------------------------------------------------------------
  it('produces the PRD 5.13 partial-verification message', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock, poolsWithoutTavilyDailyCap());

    // Exhaust the pools that high-risk uses.
    for (let i = 0; i < 700; i++) ledger.tryReserve('tavily', 1);
    for (let i = 0; i < 25; i++) ledger.tryReserve('exa', 1);
    for (let i = 0; i < 150; i++) ledger.tryReserve('gemini-grounding', 1);
    for (let i = 0; i < 10; i++) ledger.tryReserve('serper', 1);

    const provider = new MockProvider();
    // Wikipedia answers all definition claims.
    provider.set('wikipedia', { poolId: 'wikipedia', url: 'https://wiki/a' });
    const broker = new SearchBroker(provider, ledger);

    const claims: BrokerClaim[] = [
      makeClaim({ claimId: 'a', kind: 'definition' }),
      makeClaim({ claimId: 'b', kind: 'definition' }),
      makeClaim({ claimId: 'c', kind: 'high-risk', riskTier: 3 }),
      makeClaim({ claimId: 'd', kind: 'high-risk', riskTier: 3 }),
    ];

    const summary = await broker.verifyAll(claims);
    expect(summary.checkable).toBe(4);
    expect(summary.checked).toBe(2);      // a, b (Wikipedia answered)
    expect(summary.recallOnly).toBe(2);   // c, d (all pools exhausted)
    expect(summary.message).toMatch(/Checked 2 of 4 claims/);
    expect(summary.message).toMatch(/Search quota is low/);
  });

  // ---------------------------------------------------------------------------
  // Verify-later queue drain — after midnight, the *daily* pool caps
  // reset (Gemini, Exa, Serper), but Tavily's monthly reserve does not.
  // The claim that was recall-only resumes and finds Gemini's source.
  // ---------------------------------------------------------------------------
  it('verify-later queue drains claims when quota returns', async () => {
    const { clock, add } = fixedClock(new Date(2026, 9, 20, 23, 55).getTime());
    const ledger = makeLedger(clock, poolsWithoutTavilyDailyCap());

    // Exhaust all pools for the high-risk route.
    for (let i = 0; i < 700; i++) ledger.tryReserve('tavily', 1);
    for (let i = 0; i < 25; i++) ledger.tryReserve('exa', 1);
    for (let i = 0; i < 150; i++) ledger.tryReserve('gemini-grounding', 1);
    for (let i = 0; i < 10; i++) ledger.tryReserve('serper', 1);

    const provider = new MockProvider();
    const broker = new SearchBroker(provider, ledger);

    const outcome = await broker.verify(
      makeClaim({ claimId: 'q1', kind: 'high-risk', riskTier: 3 }),
    );
    expect(outcome.status).toBe('recall-only');
    expect(broker.peekQueueSize()).toBe(1);

    // Cross midnight → daily pools (Exa, Gemini, Serper) reset.
    add(10 * 60 * 1000);
    // Gemini answers after reset.
    provider.set('gemini-grounding', {
      poolId: 'gemini-grounding',
      url: 'https://ground.example/q',
    });

    const resumed = await broker.tickVerifyLater(10);
    expect(resumed.length).toBe(1);
    expect(resumed[0].claimId).toBe('q1');
    expect(resumed[0].status).toBe('verified');
    expect(broker.peekQueueSize()).toBe(0);
  });

  // ---- Queue deduplication ---------------------------------------------
  it('queue deduplicates by claimId', () => {
    const q = new VerifyLaterQueue();
    const first = q.enqueue({
      claimId: 'x',
      text: 't',
      kind: 'general',
      riskTier: 1,
      sensitivity: 'S0',
      enqueuedAt: 0,
    });
    const second = q.enqueue({
      claimId: 'x',
      text: 't',
      kind: 'general',
      riskTier: 1,
      sensitivity: 'S0',
      enqueuedAt: 1,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(q.size()).toBe(1);
  });

  // ---- Error handling ---------------------------------------------------
  it('refunds the quota on a provider error', async () => {
    const { clock } = fixedClock(new Date(2026, 9, 20, 12).getTime());
    const ledger = makeLedger(clock);
    const provider = new MockProvider();
    provider.setThrow('wikipedia', new Error('network down'));
    const broker = new SearchBroker(provider, ledger);

    await broker.verify(makeClaim({ kind: 'definition' }));
    const state = ledger.getState('wikipedia');
    expect(state.usedToday).toBe(0);
  });
});