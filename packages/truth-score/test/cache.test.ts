// === FILE START ===
// packages/truth-score/test/cache.test.ts
// PRD 8.3 step 10 · 13.8 · FR-WF-04 · FR-TRUTH-14 · T-28 (partial).
//
// Every cache behaviour: hashing, TTLs, staleness boundary, invalidation,
// LRU eviction, pruneStale, plus integration with verifyClaim (Sections 78-81).

import { describe, it, expect } from 'vitest';
import {
  VerdictCache,
  claimHash,
  CACHE_TTL_MS,
  DEFAULT_MAX_CACHE_ENTRIES,
  type CacheLookup,
} from '../src/cache.js';
import { verifyClaim, type JudgeFn } from '../src/orchestrate.js';
import { VerificationBroker } from '../src/broker.js';
import type {
  ClaimInput,
  FetchedSource,
  JudgeResponse,
} from '../src/pipeline.js';
import type { ClaimVerdict } from '../src/verdict.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function mkVerdict(overrides: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claimId: 'c1',
    claimText: 'the default claim',
    status: 'VERIFIED',
    score: 92,
    evidence: [],
    caps: [],
    penalty: 0,
    partialCheck: false,
    wouldStrengthen: [],
    glyph: '◆',
    glyphMeaning: 'Verified',
    concordance: { supports: 1, contradicts: 0, neutral: 0 },
    evidenceStrength: 'moderate',
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimId: 'c1',
    text: 'The speed of light is 299,792 km/s.',
    checkable: true,
    checked: true,
    volatility: 'stable',
    ...overrides,
  };
}

function source(overrides: Partial<FetchedSource> = {}): FetchedSource {
  return {
    id: 's1',
    url: 'https://example.com',
    title: 'Example',
    pageText: 'The speed of light in vacuum is 299,792 km/s.',
    tier: 'primary',
    ageDays: 10,
    independenceKey: 'k1',
    retrievedAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

function judgeFor(span: string): JudgeFn {
  return () => ({ stance: 'supports', span, rationale: '' });
}

// =============================================================================
// Constants
// =============================================================================

describe('CACHE_TTL_MS — PRD 13.8', () => {
  it('stable = 30 days', () => {
    expect(CACHE_TTL_MS.stable).toBe(30 * DAY_MS);
  });
  it('slow = 7 days', () => {
    expect(CACHE_TTL_MS.slow).toBe(7 * DAY_MS);
  });
  it('fast = 24 hours', () => {
    expect(CACHE_TTL_MS.fast).toBe(DAY_MS);
  });
  it('default max entries = 5,000', () => {
    expect(DEFAULT_MAX_CACHE_ENTRIES).toBe(5000);
  });
});

// =============================================================================
// claimHash
// =============================================================================

describe('claimHash — normalization', () => {
  it('lowercases', () => {
    expect(claimHash('HELLO')).toBe('hello');
  });

  it('collapses whitespace', () => {
    expect(claimHash('  hello   world  ')).toBe('hello world');
  });

  it('foldss unicode quotes', () => {
    expect(claimHash('\u201CHello\u201D')).toBe('"hello"');
  });

  it('case + whitespace variants hash the same', () => {
    expect(claimHash('The Eiffel Tower is tall')).toBe(
      claimHash('  the  eiffel tower  IS  tall  '),
    );
  });

  it('trailing newline does not change hash', () => {
    expect(claimHash('hello world\n')).toBe(claimHash('hello world'));
  });
});

// =============================================================================
// Basic put/get roundtrip
// =============================================================================

describe('VerdictCache — put/get', () => {
  it('miss on empty cache', () => {
    const c = new VerdictCache({ now: () => T0 });
    expect(c.get('hello', 'stable')).toBeNull();
  });

  it('put then get returns the verdict', () => {
    const c = new VerdictCache({ now: () => T0 });
    const v = mkVerdict();
    c.put('hello world', 'stable', v);
    const hit = c.get('hello world', 'stable');
    expect(hit).not.toBeNull();
    expect(hit!.verdict).toBe(v);
    expect(hit!.cachedAt).toBe(T0);
    expect(hit!.ageMs).toBe(0);
    expect(hit!.ttlMs).toBe(CACHE_TTL_MS.stable);
    expect(hit!.stale).toBe(false);
  });

  it('different volatility → cache miss', () => {
    const c = new VerdictCache({ now: () => T0 });
    const v = mkVerdict();
    c.put('hello', 'stable', v);
    expect(c.get('hello', 'fast')).toBeNull();
  });

  it('normalization means whitespace/case variants hit', () => {
    const c = new VerdictCache({ now: () => T0 });
    const v = mkVerdict();
    c.put('The Eiffel Tower is tall', 'stable', v);
    expect(c.get('  the  eiffel tower  IS  tall  ', 'stable')).not.toBeNull();
  });

  it('put overwrites existing entry', () => {
    const c = new VerdictCache({ now: () => T0 });
    c.put('hello', 'stable', mkVerdict({ score: 80 }));
    c.put('hello', 'stable', mkVerdict({ score: 92 }));
    const hit = c.get('hello', 'stable');
    expect(hit!.verdict.score).toBe(92);
    expect(c.size()).toBe(1);
  });
});

// =============================================================================
// Staleness
// =============================================================================

describe('VerdictCache — staleness', () => {
  it('age < ttl → stale: false', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'stable', mkVerdict());
    now = T0 + 10 * DAY_MS;
    const hit = c.get('hello', 'stable');
    expect(hit!.stale).toBe(false);
    expect(hit!.ageMs).toBe(10 * DAY_MS);
  });

  it('age === ttl → stale: true (>= comparison)', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'stable', mkVerdict());
    now = T0 + CACHE_TTL_MS.stable;
    expect(c.get('hello', 'stable')!.stale).toBe(true);
  });

  it('age > ttl → stale: true', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'fast', mkVerdict());
    now = T0 + 2 * DAY_MS;
    expect(c.get('hello', 'fast')!.stale).toBe(true);
  });

  it('fast TTL expires after 1 day', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'fast', mkVerdict());
    now = T0 + DAY_MS - 1000;
    expect(c.get('hello', 'fast')!.stale).toBe(false);
    now = T0 + DAY_MS + 1000;
    expect(c.get('hello', 'fast')!.stale).toBe(true);
  });

  it('slow TTL expires after 7 days', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'slow', mkVerdict());
    now = T0 + 7 * DAY_MS - 1000;
    expect(c.get('hello', 'slow')!.stale).toBe(false);
    now = T0 + 7 * DAY_MS + 1000;
    expect(c.get('hello', 'slow')!.stale).toBe(true);
  });

  it('stable TTL expires after 30 days', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'stable', mkVerdict());
    now = T0 + 30 * DAY_MS - 1000;
    expect(c.get('hello', 'stable')!.stale).toBe(false);
    now = T0 + 30 * DAY_MS + 1000;
    expect(c.get('hello', 'stable')!.stale).toBe(true);
  });
});

// =============================================================================
// Invalidation (FR-TRUTH-14 "Prove it")
// =============================================================================

describe('VerdictCache — invalidate', () => {
  it('invalidate removes the entry', () => {
    const c = new VerdictCache({ now: () => T0 });
    c.put('hello', 'stable', mkVerdict());
    expect(c.invalidate('hello')).toBe(true);
    expect(c.get('hello', 'stable')).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('invalidate on missing returns false', () => {
    const c = new VerdictCache({ now: () => T0 });
    expect(c.invalidate('nonexistent')).toBe(false);
  });

  it('invalidate uses normalized hash', () => {
    const c = new VerdictCache({ now: () => T0 });
    c.put('The Eiffel Tower is tall', 'stable', mkVerdict());
    expect(c.invalidate('  the  eiffel tower  IS  tall  ')).toBe(true);
    expect(c.size()).toBe(0);
  });

  it('clear empties everything', () => {
    const c = new VerdictCache({ now: () => T0 });
    c.put('a', 'stable', mkVerdict());
    c.put('b', 'stable', mkVerdict());
    c.clear();
    expect(c.size()).toBe(0);
  });
});

// =============================================================================
// LRU eviction
// =============================================================================

describe('VerdictCache — LRU eviction', () => {
  it('capacity reports the max', () => {
    const c = new VerdictCache({ maxEntries: 3 });
    expect(c.capacity()).toBe(3);
  });

  it('evicts oldest when exceeding capacity', () => {
    const c = new VerdictCache({ maxEntries: 3, now: () => T0 });
    c.put('a', 'stable', mkVerdict());
    c.put('b', 'stable', mkVerdict());
    c.put('c', 'stable', mkVerdict());
    c.put('d', 'stable', mkVerdict()); // should evict 'a'
    expect(c.size()).toBe(3);
    expect(c.get('a', 'stable')).toBeNull(); // evicted
    expect(c.get('b', 'stable')).not.toBeNull();
    expect(c.get('c', 'stable')).not.toBeNull();
    expect(c.get('d', 'stable')).not.toBeNull();
  });

  it('re-put moves entry to end (not evicted next)', () => {
    const c = new VerdictCache({ maxEntries: 3, now: () => T0 });
    c.put('a', 'stable', mkVerdict());
    c.put('b', 'stable', mkVerdict());
    c.put('c', 'stable', mkVerdict());
    // Re-put 'a' (existing) → moves to end
    c.put('a', 'stable', mkVerdict({ score: 90 }));
    // Add 'd' → should evict 'b' (now oldest)
    c.put('d', 'stable', mkVerdict());
    expect(c.get('a', 'stable')).not.toBeNull(); // still present
    expect(c.get('b', 'stable')).toBeNull(); // evicted
    expect(c.get('c', 'stable')).not.toBeNull();
    expect(c.get('d', 'stable')).not.toBeNull();
  });

  it('rejects maxEntries < 1', () => {
    const c = new VerdictCache({ maxEntries: 0 });
    expect(c.capacity()).toBe(1);
  });
});

// =============================================================================
// pruneStale
// =============================================================================

describe('VerdictCache — pruneStale', () => {
  it('removes only stale entries', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('fast-a', 'fast', mkVerdict());
    c.put('stable-b', 'stable', mkVerdict());
    // Advance past fast TTL (1 day) but not stable TTL (30 days)
    now = T0 + 2 * DAY_MS;
    const removed = c.pruneStale();
    expect(removed).toBe(1);
    expect(c.get('fast-a', 'fast')).toBeNull();
    expect(c.get('stable-b', 'stable')).not.toBeNull();
  });

  it('pruneStale on all-fresh returns 0', () => {
    const c = new VerdictCache({ now: () => T0 });
    c.put('a', 'stable', mkVerdict());
    c.put('b', 'slow', mkVerdict());
    expect(c.pruneStale()).toBe(0);
  });

  it('pruneStale on empty returns 0', () => {
    const c = new VerdictCache({ now: () => T0 });
    expect(c.pruneStale()).toBe(0);
  });
});

// =============================================================================
// Integration — verifyClaim with cache
// =============================================================================

describe('verifyClaim + cache integration', () => {
  it('first call → cache miss → real verification → verdict cached', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });
    const cl = claim();
    const src = source();
    const judge = judgeFor('299,792 km/s');

    const r1 = verifyClaim({
      claim: cl,
      sources: [src],
      judge,
      broker: b,
      cache,
      now: () => now,
    });

    expect(r1.fromCache).toBe(false);
    expect(r1.cachedAt).toBeNull();
    expect(r1.verdict.status).toBe('VERIFIED');
    expect(cache.size()).toBe(1);

    // Broker used 1 unit on wikipedia
    const wikiUsed = b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday;
    expect(wikiUsed).toBe(1);
  });

  it('second call → cache hit → no broker usage', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });
    const cl = claim();
    const src = source();
    const judge = judgeFor('299,792 km/s');

    // Prime the cache
    const r1 = verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    const wikiUsedBefore = b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday;

    // Second call — should hit cache, no broker usage
    const r2 = verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    const wikiUsedAfter = b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday;

    expect(r2.fromCache).toBe(true);
    expect(r2.cachedAt).toBe(T0);
    expect(r2.verdict.status).toBe(r1.verdict.status);
    expect(r2.verdict.score).toBe(r1.verdict.score);
    expect(wikiUsedAfter).toBe(wikiUsedBefore); // no additional usage
  });

  it('stale cache → re-verify → re-cache', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });
    const cl = claim({ volatility: 'fast' }); // 24h TTL
    const src = source();
    const judge = judgeFor('299,792 km/s');

    // First call primes cache
    verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    expect(cache.get(cl.text, 'fast')!.stale).toBe(false);

    // Advance past fast TTL
    now = T0 + 2 * DAY_MS;
    expect(cache.get(cl.text, 'fast')!.stale).toBe(true);

    // Second call → cache stale → re-verifies → re-caches with new time
    const r2 = verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    expect(r2.fromCache).toBe(false); // this call re-verified
    expect(r2.cachedAt).toBeNull();
    // Cache now has fresh entry at 'now'
    const hit = cache.get(cl.text, 'fast');
    expect(hit!.cachedAt).toBe(now);
    expect(hit!.stale).toBe(false);
  });

  it('invalidate + next call is a cache miss', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });
    const cl = claim();
    const src = source();
    const judge = judgeFor('299,792 km/s');

    // Prime cache
    verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    const wikiUsedBefore = b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday;

    // "Prove it" — invalidate
    expect(cache.invalidate(cl.text)).toBe(true);

    // Next call → miss → re-verifies
    const r3 = verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    expect(r3.fromCache).toBe(false);
    const wikiUsedAfter = b.getStatus().find((s) => s.id === 'wikipedia')!.usedToday;
    expect(wikiUsedAfter).toBe(wikiUsedBefore + 1); // one more reservation
  });

  it('deferred (quota exhausted) results are NOT cached', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });

    // Exhaust every pool the chain touches
    for (let i = 0; i < 150; i++) b.reserve('gemini-grounding', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('tavily', 1, 'verify');
    for (let i = 0; i < 25; i++) b.reserve('exa', 1, 'verify');
    for (let i = 0; i < 10; i++) b.reserve('serper', 1, 'verify');
    for (let i = 0; i < 300; i++) b.reserve('wikipedia', 1, 'verify');
    for (let i = 0; i < 60; i++) b.reserve('arxiv', 1, 'verify');
    for (let i = 0; i < 20; i++) b.reserve('jina', 1, 'verify');

    const cl = claim({ claimId: 'defer' });
    const src = source({ id: 's-defer' });
    const judge = judgeFor('299,792 km/s');

    const r = verifyClaim({ claim: cl, sources: [src], judge, broker: b, cache, now: () => now });
    expect(r.deferred).toBe(true);
    expect(cache.size()).toBe(0); // deferred results never cached
  });

  it('NOT_SCORED (checkable:false) is NOT cached', () => {
    const b = new VerificationBroker({ now: () => T0 });
    const cache = new VerdictCache({ now: () => T0 });
    const cl = claim({ checkable: false });
    const src = source();

    verifyClaim({
      claim: cl,
      sources: [src],
      judge: judgeFor('x'),
      broker: b,
      cache,
      now: () => T0,
    });
    expect(cache.size()).toBe(0);
  });

  it('RECALL_ONLY (checked:false) is NOT cached', () => {
    const b = new VerificationBroker({ now: () => T0 });
    const cache = new VerdictCache({ now: () => T0 });
    const cl = claim({ checked: false });
    const src = source();

    verifyClaim({
      claim: cl,
      sources: [src],
      judge: judgeFor('x'),
      broker: b,
      cache,
      now: () => T0,
    });
    expect(cache.size()).toBe(0);
  });

  it('UNVERIFIED from empty sources IS cached (has a real score)', () => {
    const b = new VerificationBroker({ now: () => T0 });
    const cache = new VerdictCache({ now: () => T0 });
    const cl = claim();

    const r = verifyClaim({
      claim: cl,
      sources: [], // Terminal 3
      judge: judgeFor('x'),
      broker: b,
      cache,
      now: () => T0,
    });
    expect(r.verdict.status).toBe('UNVERIFIED');
    expect(cache.size()).toBe(1); // cached
    expect(cache.get(cl.text, 'stable')).not.toBeNull();
  });

  it('different claim text → different cache entry', () => {
    let now = T0;
    const b = new VerificationBroker({ now: () => now });
    const cache = new VerdictCache({ now: () => now });
    const judge = judgeFor('page text');

    verifyClaim({
      claim: claim({ claimId: 'a', text: 'Claim A' }),
      sources: [source({ id: 'sa', pageText: 'Claim A page text.' })],
      judge,
      broker: b,
      cache,
      now: () => now,
    });
    verifyClaim({
      claim: claim({ claimId: 'b', text: 'Claim B' }),
      sources: [source({ id: 'sb', pageText: 'Claim B page text.' })],
      judge,
      broker: b,
      cache,
      now: () => now,
    });
    expect(cache.size()).toBe(2);
  });

  it('no cache provided → fromCache:false, cachedAt:null', () => {
    const b = new VerificationBroker({ now: () => T0 });
    const cl = claim();
    const src = source();

    const r = verifyClaim({
      claim: cl,
      sources: [src],
      judge: judgeFor('299,792 km/s'),
      broker: b,
      // NO cache
      now: () => T0,
    });
    expect(r.fromCache).toBe(false);
    expect(r.cachedAt).toBeNull();
    expect(r.verdict.status).toBe('VERIFIED');
  });
});

// =============================================================================
// Sanity: exact-shape check on CacheLookup
// =============================================================================

describe('CacheLookup shape', () => {
  it('every field is populated on hit', () => {
    let now = T0;
    const c = new VerdictCache({ now: () => now });
    c.put('hello', 'slow', mkVerdict());
    now = T0 + DAY_MS;

    const hit = c.get('hello', 'slow');
    expect(hit).not.toBeNull();
    const typed: CacheLookup = hit!;
    expect(typed.verdict.status).toBe('VERIFIED');
    expect(typed.cachedAt).toBe(T0);
    expect(typed.ageMs).toBe(DAY_MS);
    expect(typed.ttlMs).toBe(CACHE_TTL_MS.slow);
    expect(typed.stale).toBe(false);
  });
});
// === FILE END ===