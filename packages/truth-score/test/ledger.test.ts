// === FILE START ===
// packages/truth-score/test/ledger.test.ts
// PRD FR-TRUTH-23 · F-257.
//
// Claim Ledger: insert, search (text/status/date), cursor pagination,
// correction history, duplicate protection.

import { describe, it, expect } from 'vitest';
import { ClaimLedger } from '../src/ledger.js';
import type { ClaimVerdict } from '../src/verdict.js';
import type { ClaimStatus } from '../src/types.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

function verdict(
  claimId: string,
  status: ClaimStatus,
  score: number | null,
  overrides: Partial<ClaimVerdict> = {},
): ClaimVerdict {
  return {
    claimId,
    claimText: `Claim ${claimId} about topic`,
    status,
    score,
    evidence: [],
    caps: [],
    penalty: 0,
    partialCheck: false,
    wouldStrengthen: [],
    glyph:
      status === 'VERIFIED'
        ? '◆'
        : status === 'CONFLICTED'
          ? '!'
          : status === 'UNVERIFIED'
            ? '?'
            : status === 'RECALL_ONLY'
              ? '-'
              : status === 'NOT_SCORED'
                ? ''
                : '△',
    glyphMeaning: status,
    concordance: { supports: 0, contradicts: 0, neutral: 0 },
    evidenceStrength: 'none',
    ...overrides,
  };
}

// =============================================================================
// addClaim
// =============================================================================

describe('addClaim', () => {
  it('adds a claim and sets createdAt', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    const entry = l.findByClaimId('c1')!;
    expect(entry.claimId).toBe('c1');
    expect(entry.status).toBe('VERIFIED');
    expect(entry.score).toBe(92);
    expect(entry.glyph).toBe('◆');
    expect(entry.turnId).toBe('t1');
    expect(entry.createdAt).toBe(T0);
    expect(entry.history.length).toBe(1);
    expect(entry.history[0].reason).toBe('initial');
    expect(entry.history[0].previousStatus).toBeNull();
    expect(entry.history[0].newStatus).toBe('VERIFIED');
  });

  it('throws on duplicate claimId', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    expect(() =>
      l.addClaim(verdict('c1', 'SUPPORTED', 80), { turnId: 't2' }),
    ).toThrow(/already exists/);
  });

  it('copies caps array (no aliasing)', () => {
    const l = new ClaimLedger({ now: () => T0 });
    const v = verdict('c1', 'UNVERIFIED', 40, { caps: ['quote_failed'] });
    l.addClaim(v, { turnId: 't1' });
    v.caps.push('mutated');
    expect(l.findByClaimId('c1')!.caps).toEqual(['quote_failed']);
  });
});

// =============================================================================
// findByClaimId
// =============================================================================

describe('findByClaimId', () => {
  it('returns null for unknown claimId', () => {
    const l = new ClaimLedger();
    expect(l.findByClaimId('nonexistent')).toBeNull();
  });

  it('returns the full entry for a known claimId', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    const e = l.findByClaimId('c1');
    expect(e).not.toBeNull();
    expect(e!.claimText).toContain('c1');
  });
});

// =============================================================================
// recordCorrection — history accumulates
// =============================================================================

describe('recordCorrection', () => {
  it('appends a history entry and updates current status', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    l.addClaim(verdict('c1', 'MIXED', 60), { turnId: 't1' });

    now = T0 + 60_000;
    l.recordCorrection(
      'c1',
      verdict('c1', 'VERIFIED', 90),
      're-verified',
    );

    const e = l.findByClaimId('c1')!;
    expect(e.status).toBe('VERIFIED');
    expect(e.score).toBe(90);
    expect(e.history.length).toBe(2);
    expect(e.history[1].reason).toBe('re-verified');
    expect(e.history[1].previousStatus).toBe('MIXED');
    expect(e.history[1].previousScore).toBe(60);
    expect(e.history[1].newStatus).toBe('VERIFIED');
    expect(e.history[1].newScore).toBe(90);
  });

  it('supports multiple corrections, preserving every step', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'WEAK', 40), { turnId: 't1' });
    l.recordCorrection('c1', verdict('c1', 'MIXED', 55), 're-verified');
    l.recordCorrection('c1', verdict('c1', 'SUPPORTED', 78), 're-verified');
    l.recordCorrection('c1', verdict('c1', 'VERIFIED', 90), 'corrected');

    const e = l.findByClaimId('c1')!;
    expect(e.history.length).toBe(4);
    expect(e.history.map((h) => h.newStatus)).toEqual([
      'WEAK',
      'MIXED',
      'SUPPORTED',
      'VERIFIED',
    ]);
  });

  it('throws on unknown claimId', () => {
    const l = new ClaimLedger({ now: () => T0 });
    expect(() =>
      l.recordCorrection('nonexistent', verdict('x', 'VERIFIED', 92)),
    ).toThrow(/not found/);
  });
});

// =============================================================================
// search — filters
// =============================================================================

describe('search — text filter', () => {
  it('case-insensitive substring match on claimText', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(
      verdict('c1', 'VERIFIED', 92, { claimText: 'The Eiffel Tower is tall' }),
      { turnId: 't1' },
    );
    l.addClaim(
      verdict('c2', 'VERIFIED', 92, { claimText: 'The Louvre is in Paris' }),
      { turnId: 't1' },
    );

    const r1 = l.search({ text: 'eiffel' });
    expect(r1.items.length).toBe(1);
    expect(r1.items[0].claimId).toBe('c1');

    const r2 = l.search({ text: 'PARIS' });
    expect(r2.items.length).toBe(1);
    expect(r2.items[0].claimId).toBe('c2');

    const r3 = l.search({ text: 'nonexistent' });
    expect(r3.items.length).toBe(0);
  });

  it('empty text matches all', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    l.addClaim(verdict('c2', 'MIXED', 55), { turnId: 't1' });
    expect(l.search({ text: '' }).items.length).toBe(2);
  });
});

describe('search — status filter', () => {
  it('exact status match', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    l.addClaim(verdict('c2', 'MIXED', 55), { turnId: 't1' });
    l.addClaim(verdict('c3', 'VERIFIED', 88), { turnId: 't1' });

    const r = l.search({ status: 'VERIFIED' });
    expect(r.items.map((i) => i.claimId).sort()).toEqual(['c1', 'c3']);
  });
});

describe('search — date filter', () => {
  it('fromDate includes items at or after', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' }); // createdAt T0
    const l2 = new ClaimLedger({ now: () => T0 + 1000 });
    l2.addClaim(verdict('c2', 'VERIFIED', 92), { turnId: 't2' });

    // Search l with fromDate T0 → includes c1
    expect(l.search({ fromDate: T0 }).items.length).toBe(1);
    // Search l with fromDate T0 + 1 → excludes c1
    expect(l.search({ fromDate: T0 + 1 }).items.length).toBe(0);
  });

  it('toDate includes items at or before', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    expect(l.search({ toDate: T0 }).items.length).toBe(1);
    expect(l.search({ toDate: T0 - 1 }).items.length).toBe(0);
  });

  it('combined fromDate + toDate narrows the range', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    for (let i = 0; i < 5; i++) {
      now = T0 + i * 1000;
      l.addClaim(verdict(`c${i}`, 'VERIFIED', 92), { turnId: 't1' });
    }
    const r = l.search({ fromDate: T0 + 1000, toDate: T0 + 2000 });
    // c1 (1000) and c2 (2000) match
    expect(r.items.map((i) => i.claimId).sort()).toEqual(['c1', 'c2']);
  });
});

describe('search — combined filters (AND)', () => {
  it('text + status together narrows', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(
      verdict('c1', 'VERIFIED', 92, { claimText: 'Eiffel Tower fact' }),
      { turnId: 't1' },
    );
    l.addClaim(
      verdict('c2', 'MIXED', 55, { claimText: 'Eiffel Tower guess' }),
      { turnId: 't1' },
    );
    const r = l.search({ text: 'eiffel', status: 'VERIFIED' });
    expect(r.items.length).toBe(1);
    expect(r.items[0].claimId).toBe('c1');
  });
});

// =============================================================================
// search — ordering + pagination
// =============================================================================

describe('search — newest-first order', () => {
  it('returns claims ordered by createdAt DESC', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    for (let i = 0; i < 5; i++) {
      now = T0 + i * 1000;
      l.addClaim(verdict(`c${i}`, 'VERIFIED', 92), { turnId: 't1' });
    }
    const r = l.search({});
    // Newest first: c4, c3, c2, c1, c0
    expect(r.items.map((i) => i.claimId)).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
  });
});

describe('search — cursor pagination', () => {
  it('paginates through 100 claims in 10-item pages', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    for (let i = 0; i < 100; i++) {
      now = T0 + i;
      l.addClaim(verdict(`c${String(i).padStart(3, '0')}`, 'VERIFIED', 92), {
        turnId: 't1',
      });
    }

    // Page 1
    const p1 = l.search({ limit: 10 });
    expect(p1.items.length).toBe(10);
    expect(p1.items[0].claimId).toBe('c099');
    expect(p1.nextCursor).not.toBeNull();
    expect(p1.totalCount).toBe(100);

    // Page 2
    const p2 = l.search({ limit: 10, cursor: p1.nextCursor! });
    expect(p2.items.length).toBe(10);
    expect(p2.items[0].claimId).toBe('c089');
    expect(p2.nextCursor).not.toBeNull();

    // Walk through all pages, expect 10 pages total
    let cursor: string | null = p2.nextCursor;
    let pages = 2;
    const seen = new Set<string>([
      ...p1.items.map((i) => i.claimId),
      ...p2.items.map((i) => i.claimId),
    ]);
    while (cursor) {
      const p = l.search({ limit: 10, cursor });
      expect(p.items.length).toBe(10);
      for (const item of p.items) {
        expect(seen.has(item.claimId)).toBe(false); // no duplicates
        seen.add(item.claimId);
      }
      cursor = p.nextCursor;
      pages++;
      if (pages > 20) throw new Error('pagination loop');
    }
    expect(pages).toBe(10);
    expect(seen.size).toBe(100);
  });

  it('nextCursor is null when at the last page', () => {
    const l = new ClaimLedger({ now: () => T0 });
    for (let i = 0; i < 5; i++) {
      l.addClaim(verdict(`c${i}`, 'VERIFIED', 92), { turnId: 't1' });
    }
    const p1 = l.search({ limit: 3 });
    expect(p1.items.length).toBe(3);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = l.search({ limit: 3, cursor: p1.nextCursor! });
    expect(p2.items.length).toBe(2);
    expect(p2.nextCursor).toBeNull();
  });

  it('empty result returns null cursor', () => {
    const l = new ClaimLedger();
    const r = l.search({});
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
    expect(r.totalCount).toBe(0);
  });

  it('limit caps at 100', () => {
    const l = new ClaimLedger({ now: () => T0 });
    for (let i = 0; i < 200; i++) {
      l.addClaim(verdict(`c${i}`, 'VERIFIED', 92), { turnId: 't1' });
    }
    const r = l.search({ limit: 9999 });
    expect(r.items.length).toBe(100);
  });

  it('limit clamps at 1 (minimum)', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    const r = l.search({ limit: 0 });
    expect(r.items.length).toBe(1);
  });
});

// =============================================================================
// getAll + size
// =============================================================================

describe('getAll + size', () => {
  it('getAll returns insertion-order array', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    for (let i = 0; i < 3; i++) {
      now = T0 + i;
      l.addClaim(verdict(`c${i}`, 'VERIFIED', 92), { turnId: 't1' });
    }
    const all = l.getAll();
    expect(all.map((e) => e.claimId)).toEqual(['c0', 'c1', 'c2']);
  });

  it('size tracks inserted count', () => {
    const l = new ClaimLedger({ now: () => T0 });
    expect(l.size()).toBe(0);
    l.addClaim(verdict('c1', 'VERIFIED', 92), { turnId: 't1' });
    expect(l.size()).toBe(1);
    l.addClaim(verdict('c2', 'MIXED', 55), { turnId: 't1' });
    expect(l.size()).toBe(2);
  });

  it('size does NOT drop on recordCorrection', () => {
    const l = new ClaimLedger({ now: () => T0 });
    l.addClaim(verdict('c1', 'MIXED', 55), { turnId: 't1' });
    l.recordCorrection('c1', verdict('c1', 'VERIFIED', 92));
    expect(l.size()).toBe(1);
  });
});

// =============================================================================
// Stress: 1000 claims
// =============================================================================

describe('Stress — 1000 claims', () => {
  it('inserts 1000 claims in order, search returns correct counts', () => {
    let now = T0;
    const l = new ClaimLedger({ now: () => now });
    for (let i = 0; i < 1000; i++) {
      now = T0 + i;
      l.addClaim(
        verdict(`c${String(i).padStart(4, '0')}`, 'VERIFIED', 92, {
          claimText: `Claim number ${i} about topic ${i % 10}`,
        }),
        { turnId: 't1' },
      );
    }
    expect(l.size()).toBe(1000);

    // All claims
    expect(l.search({ limit: 100 }).totalCount).toBe(1000);

    // By status
    expect(l.search({ status: 'VERIFIED', limit: 100 }).totalCount).toBe(1000);

    // By text
    const r = l.search({ text: 'topic 3', limit: 100 });
    expect(r.totalCount).toBe(100); // 1000/10 = 100
  });
});
// === FILE END ===