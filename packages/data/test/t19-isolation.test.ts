// === FILE START ===
// packages/data/test/t19-isolation.test.ts
// PRD 12.6 · FR-PROF-01 · T-19.
//
// T-19 gate: profile A cannot read or write profile B's store, D1 rows
// or Durable Object state. 0 cross-profile access in 100 attempts.

import { describe, it, expect } from 'vitest';
import {
  ScopedStore,
  IsolationViolation,
  createRawStore,
} from '../src/profile-isolation.js';

// =============================================================================
// T-19.1 — Basic contract
// =============================================================================

describe('T-19.1 — ScopedStore ownership contract', () => {
  it('read defaults to the scope profile and returns its rows', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    a.write([{ id: 'r1', text: 'A-data' }]);
    const rows = a.read();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('r1');
  });

  it('two ScopedStores over the same raw store are isolated by profileId', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    const b = new ScopedStore(raw, 'B');
    a.write([{ id: 'r1' }]);
    b.write([{ id: 'r2' }]);
    expect(a.read().map((r) => r.id)).toEqual(['r1']);
    expect(b.read().map((r) => r.id)).toEqual(['r2']);
  });

  it('writing with the wrong profileId throws IsolationViolation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    expect(() => a.write([{ id: 'x' }], 'B')).toThrow(IsolationViolation);
  });

  it('reading with the wrong profileId throws IsolationViolation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    expect(() => a.read('B')).toThrow(IsolationViolation);
  });

  it('find with the wrong profileId throws IsolationViolation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    expect(() => a.find('anything', 'B')).toThrow(IsolationViolation);
  });

  it('append with the wrong profileId throws IsolationViolation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    expect(() => a.append({ id: 'x' }, 'B')).toThrow(IsolationViolation);
  });

  it('IsolationViolation carries scope / attempted / operation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    try {
      a.read('B');
      throw new Error('expected IsolationViolation');
    } catch (err) {
      expect(err).toBeInstanceOf(IsolationViolation);
      const iv = err as IsolationViolation;
      expect(iv.scopeProfileId).toBe('A');
      expect(iv.attemptedProfileId).toBe('B');
      expect(iv.operation).toBe('read');
    }
  });

  it('rejects empty profileId at construction', () => {
    const raw = createRawStore();
    expect(() => new ScopedStore(raw, '')).toThrow();
  });

  it('append rejects duplicate id within the same profile', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    a.append({ id: 'r1' });
    expect(() => a.append({ id: 'r1' })).toThrow(/already exists/);
  });

  it('reads are clones — mutation does not affect the store', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    a.write([{ id: 'r1', text: 'original' }]);
    const rows = a.read();
    (rows[0] as { text: string }).text = 'MUTATED';
    expect((a.read()[0] as { text: string }).text).toBe('original');
  });
});

// =============================================================================
// T-19.2 — GATE: 0 cross-profile access across 100 adversarial attempts
// =============================================================================

describe('T-19.2 — GATE: 0 successful cross-profile access in 100 attempts', () => {
  it('100 adversarial read/write attempts all fail with IsolationViolation', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    const b = new ScopedStore(raw, 'B');

    // Seed both profiles with data.
    a.write([{ id: 'a-1', text: 'A1' }]);
    b.write([{ id: 'b-1', text: 'B1' }]);

    const ops = ['read', 'write', 'append', 'find'] as const;
    let violations = 0;
    let leak = 0;

    for (let i = 0; i < 100; i++) {
      const op = ops[i % ops.length];
      try {
        if (op === 'read') a.read('B');
        else if (op === 'write') a.write([{ id: 'x' }], 'B');
        else if (op === 'append') a.append({ id: 'x' }, 'B');
        else if (op === 'find') a.find('b-1', 'B');
      } catch (err) {
        if (err instanceof IsolationViolation) {
          violations += 1;
          continue;
        }
        throw err;
      }
      leak += 1;
    }

    expect(violations).toBe(100);
    expect(leak).toBe(0);
  });

  it('leaked data never appears after a failed read', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    const b = new ScopedStore(raw, 'B');
    b.write([{ id: 'b-secret', text: 'PROFILE-B-SECRET' }]);
    a.write([{ id: 'a-only', text: 'A-data' }]);

    // Try 50 reads with B — each throws.
    for (let i = 0; i < 50; i++) {
      expect(() => a.read('B')).toThrow(IsolationViolation);
    }
    // A's own read never returns B's row.
    const aRows = a.read();
    expect(aRows.some((r) => r.id === 'b-secret')).toBe(false);
  });

  it('failed write to B leaves A untouched and B unchanged', () => {
    const raw = createRawStore();
    const a = new ScopedStore(raw, 'A');
    const b = new ScopedStore(raw, 'B');
    a.write([{ id: 'a-1' }]);
    b.write([{ id: 'b-1' }]);

    try {
      a.write([{ id: 'evil' }], 'B');
    } catch {
      // expected
    }
    expect(a.read().map((r) => r.id)).toEqual(['a-1']);
    expect(b.read().map((r) => r.id)).toEqual(['b-1']);
  });
});
// === FILE END ===