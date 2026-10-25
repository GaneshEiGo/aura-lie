// packages/memory-curator/test/memory-curator.test.ts
// Rebuilt: exercises every stage of the curator pipeline.
import { describe, it, expect } from 'vitest';
import {
  cosine,
  isDurable,
  containsSecret,
  classifySensitivity,
  defaultLifetime,
  computeExpiry,
  findDuplicate,
  findContradiction,
  MemoryCurator,
} from '../src/index.js';
import type { Memory, MemoryCandidate } from '../src/index.js';

const DAY = 86_400_000;

function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    userId: 'u1',
    type: 'semantic',
    text: 'prefers minimal interfaces',
    origin: 'USER',
    createdAt: 1_000,
    lastVerifiedAt: 1_000,
    importance: 2,
    sensitivity: 'S0',
    pinned: false,
    frozen: false,
    status: 'active',
    provenanceFloor: 'USER',
    ...overrides,
  };
}

function cand(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    text: 'prefers minimal interfaces',
    type: 'semantic',
    origin: 'USER',
    importance: 2,
    sensitivity: 'S0',
    ...overrides,
  };
}

describe('cosine (PRD 9.5 duplicate stage)', () => {
  it('is 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('is 0 when either vector is all zeros', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it('is symmetric', () => {
    expect(cosine([1, 2, 3], [4, 5, 6])).toBeCloseTo(
      cosine([4, 5, 6], [1, 2, 3]),
      8,
    );
  });
  it('handles mismatched lengths by using the shorter', () => {
    expect(cosine([1, 0], [1, 0, 0, 0])).toBeCloseTo(1, 6);
  });
});

describe('isDurable (PRD 9.5 importance stage)', () => {
  it('accepts a durable preference', () => {
    expect(isDurable(cand({ text: 'prefers minimal interfaces' }))).toBe(true);
  });
  it('rejects pure chitchat', () => {
    expect(isDurable(cand({ text: 'thanks' }))).toBe(false);
    expect(isDurable(cand({ text: 'hello' }))).toBe(false);
  });
  it('rejects trivially short text', () => {
    expect(isDurable(cand({ text: 'ok' }))).toBe(false);
  });
  it('rejects importance < 1', () => {
    expect(isDurable(cand({ importance: 0 }))).toBe(false);
  });
});

describe('containsSecret (PRD 9.5 privacy stage)', () => {
  it('detects sk- style API keys', () => {
    expect(containsSecret('my key is sk-abcdefghij1234567890xyz')).toBe(true);
  });
  it('detects GitHub personal access tokens', () => {
    expect(containsSecret('token ghp_abcdefghij1234567890ABCDEFG')).toBe(true);
  });
  it('detects PEM private keys', () => {
    expect(containsSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  });
  it('passes ordinary text', () => {
    expect(containsSecret('I love green tea')).toBe(false);
  });
});

describe('classifySensitivity (PRD 9.5 privacy stage)', () => {
  it('defaults to S0', () => {
    expect(classifySensitivity('loves green tea')).toBe('S0');
  });
  it('promotes health-related text to S2', () => {
    expect(classifySensitivity('my medical diagnosis is private')).toBe('S2');
  });
  it('respects an explicit S2 hint even without keywords', () => {
    expect(classifySensitivity('plain text', 'S2')).toBe('S2');
  });
});

describe('defaultLifetime + computeExpiry (PRD 9.2)', () => {
  it('episodic defaults to 180 days', () => {
    expect(defaultLifetime('episodic')).toBe(180);
  });
  it('semantic has no default expiry', () => {
    expect(defaultLifetime('semantic')).toBeNull();
  });
  it('temporal gets a reviewAt, not an expiresAt', () => {
    const r = computeExpiry('temporal', 1_000, cand({ type: 'temporal' }));
    expect(r.reviewAt).toBe(1_000 + 14 * DAY);
    expect(r.expiresAt).toBeUndefined();
  });
});

describe('findDuplicate (PRD 9.5 duplicate stage)', () => {
  it('matches by cosine ≥ 0.92', () => {
    const existing = [mem({ id: 'm1', embedding: { values: [1, 0, 0] } })];
    const c = cand({ embedding: { values: [0.99, 0.01, 0] } });
    expect(findDuplicate(c, existing)?.id).toBe('m1');
  });
  it('matches by exact text fallback', () => {
    const existing = [mem({ id: 'm1', text: 'prefers minimal interfaces' })];
    const c = cand({ text: 'prefers minimal interfaces' });
    expect(findDuplicate(c, existing)?.id).toBe('m1');
  });
  it('returns undefined when nothing matches', () => {
    const existing = [mem({ id: 'm1', text: 'lives in Bengaluru' })];
    expect(findDuplicate(cand({ text: 'prefers minimal interfaces' }), existing)).toBeUndefined();
  });
});

describe('findContradiction (PRD 9.5 contradiction stage)', () => {
  it('flags prefers vs dislikes on the same type', () => {
    const existing = [mem({ id: 'm1', text: 'dislikes notification spam' })];
    const c = cand({ text: 'prefers notification spam' });
    expect(findContradiction(c, existing)?.id).toBe('m1');
  });
  it('returns undefined when no contradiction exists', () => {
    const existing = [mem({ id: 'm1', text: 'prefers minimal interfaces' })];
    expect(findContradiction(cand({ text: 'lives in Bengaluru' }), existing)).toBeUndefined();
  });
});

describe('MemoryCurator.curate (PRD 9.5 orchestrator)', () => {
  it('stores a durable candidate', () => {
    const c = new MemoryCurator({ clock: { now: () => 1_000 } });
    const d = c.curate(cand());
    expect(d.action).toBe('store');
    expect(d.memory?.id).toBeTruthy();
    expect(c.list()).toHaveLength(1);
  });

  it('discards chitchat', () => {
    const c = new MemoryCurator({ clock: { now: () => 1_000 } });
    const d = c.curate(cand({ text: 'thanks' }));
    expect(d.action).toBe('discard');
    expect(d.reason).toBe('not_durable');
    expect(c.list()).toHaveLength(0);
  });

  it('discards anything containing a secret', () => {
    const c = new MemoryCurator({ clock: { now: () => 1_000 } });
    const d = c.curate(cand({ text: 'my key is sk-abcdefghij1234567890xyz' }));
    expect(d.action).toBe('discard');
    expect(d.reason).toBe('contains_secret');
  });

  it('asks for approval on S2 content', () => {
    const c = new MemoryCurator({ clock: { now: () => 1_000 } });
    const d = c.curate(cand({ text: 'my medical diagnosis is private', sensitivity: 'S0' }));
    expect(d.action).toBe('ask');
    expect(d.memory?.status).toBe('pending_approval');
    expect(c.list()).toHaveLength(0);
  });

  it('merges duplicates instead of adding a second copy', () => {
    const c = new MemoryCurator({
      clock: { now: () => 1_000 },
      idGenerator: (() => {
        let n = 0;
        return () => `id${++n}`;
      })(),
    });
    c.curate(cand({ text: 'prefers minimal interfaces' }));
    const d = c.curate(cand({ text: 'prefers minimal interfaces' }));
    expect(d.action).toBe('store');
    expect(d.reason).toBe('merged_duplicate');
    expect(c.list()).toHaveLength(1);
  });

  it('archives an old memory when the user contradicts themselves', () => {
    const c = new MemoryCurator({
      clock: { now: () => 1_000 },
      idGenerator: (() => {
        let n = 0;
        return () => `id${++n}`;
      })(),
    });
    c.curate(cand({ text: 'dislikes notification spam' }));
    const d = c.curate(cand({ text: 'prefers notification spam' }));
    expect(d.action).toBe('store');
    expect(d.superseded).toBeTruthy();
    const archived = c.list().find((m) => m.status === 'archived');
    expect(archived).toBeTruthy();
  });
});