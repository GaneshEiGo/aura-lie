// === FILE START ===
// packages/track-record/test/replay-v2.test.ts
// PRD §18.3 FR-TRACET-03 · §15.2 T-07.

import { describe, it, expect } from 'vitest';
import {
  replayTurn,
  replaySignature,
  type ReplayEvent,
} from '../src/replay-v2.js';

function sampleEvents(): ReplayEvent[] {
  return [
    {
      seq: 1,
      t: 'meta',
      mode: 'council',
      persona: 'yuki',
      sensitivity: 'S1',
      riskTier: 2,
    },
    { seq: 2, t: 'token', delta: 'Yes, ' },
    { seq: 3, t: 'token', delta: 'with caveats.' },
    {
      seq: 4,
      t: 'claim',
      id: 'c1',
      text: 'Runway is 14 months.',
      claimType: 'numeric',
      importance: 0.85,
    },
    {
      seq: 5,
      t: 'claim',
      id: 'c2',
      text: 'Income is stable.',
      claimType: 'causal',
      importance: 0.6,
    },
    {
      seq: 6,
      t: 'source',
      id: 's1',
      title: 'Financial model',
      domain: 'internal.example',
      tier: 75,
    },
    { seq: 7, t: 'score', claimId: 'c1', score: 88, status: 'VERIFIED' },
    { seq: 8, t: 'score', claimId: 'c2', score: 62, status: 'MIXED' },
    {
      seq: 9,
      t: 'summary',
      overall: 72,
      checked: 2,
      checkable: 2,
      chip: 'SUPPORTED',
    },
    { seq: 10, t: 'done', elapsedMs: 3400, calls: 5, tokens: 1200, costInr: 0 },
  ];
}

describe('replayTurn — reproduces the turn from events', () => {
  it('assembles the answer from all token deltas', () => {
    expect(replayTurn(sampleEvents()).answer).toBe('Yes, with caveats.');
  });

  it('collects every claim, keyed by id', () => {
    const r = replayTurn(sampleEvents());
    expect(r.claims.length).toBe(2);
    expect(r.claims.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('attaches scores to the right claims', () => {
    const r = replayTurn(sampleEvents());
    const c1 = r.claims.find((c) => c.id === 'c1')!;
    const c2 = r.claims.find((c) => c.id === 'c2')!;
    expect(c1.score).toBe(88);
    expect(c1.status).toBe('VERIFIED');
    expect(c2.score).toBe(62);
    expect(c2.status).toBe('MIXED');
  });

  it('collects sources', () => {
    const r = replayTurn(sampleEvents());
    expect(r.sources.length).toBe(1);
    expect(r.sources[0]!.title).toBe('Financial model');
  });

  it('captures meta/summary/done', () => {
    const r = replayTurn(sampleEvents());
    expect(r.meta!.mode).toBe('council');
    expect(r.summary!.overall).toBe(72);
    expect(r.done!.costInr).toBe(0);
  });
});

describe('replayTurn — purity and determinism', () => {
  it('two calls produce identical signatures', () => {
    const events = sampleEvents();
    expect(replaySignature(replayTurn(events))).toBe(
      replaySignature(replayTurn(events)),
    );
  });

  it('does not mutate the input array', () => {
    const events = sampleEvents();
    const before = JSON.stringify(events);
    replayTurn(events);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('handles a claim without a score', () => {
    const events: ReplayEvent[] = [
      { seq: 1, t: 'token', delta: 'hi' },
      {
        seq: 2,
        t: 'claim',
        id: 'c1',
        text: 'unscored',
        claimType: 'definition',
        importance: 0.5,
      },
    ];
    const r = replayTurn(events);
    expect(r.claims[0]!.score).toBeNull();
    expect(r.claims[0]!.status).toBeNull();
  });

  it('handles score event that arrives before its claim', () => {
    const events: ReplayEvent[] = [
      { seq: 1, t: 'score', claimId: 'c1', score: 55, status: 'MIXED' },
      {
        seq: 2,
        t: 'claim',
        id: 'c1',
        text: 'x',
        claimType: 'numeric',
        importance: 0.4,
      },
    ];
    const r = replayTurn(events);
    expect(r.claims[0]!.score).toBe(55);
  });

  it('handles unknown claim id in score gracefully', () => {
    const events: ReplayEvent[] = [
      { seq: 1, t: 'score', claimId: 'ghost', score: 99, status: 'VERIFIED' },
      { seq: 2, t: 'token', delta: 'x' },
    ];
    // Should not throw — ghost claim is silently dropped
    const r = replayTurn(events);
    expect(r.claims).toEqual([]);
  });

  it('event_count is the input length regardless of filtering', () => {
    const events = sampleEvents();
    expect(replayTurn(events).event_count).toBe(events.length);
  });

  it('large event list assembles deterministically', () => {
    const events: ReplayEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      events.push({ seq: i + 1, t: 'token', delta: `${i},` });
    }
    const r = replayTurn(events);
    expect(r.answer).toBe(
      Array.from({ length: 1000 }, (_, i) => `${i},`).join(''),
    );
    expect(replaySignature(r)).toBe(replaySignature(replayTurn(events)));
  });
});
// === FILE END ===