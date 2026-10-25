// === FILE START ===
// packages/data/test/wipe.test.ts
// PRD 9.9 · FR-DATA-04 · T-18.
//
// Absolute wipe proof:
//   · correct confirm word wipes everything
//   · wrong confirm word aborts (nothing lost)
//   · audit row records only { at, action: 'WIPE' } — never content
//   · no recoverable data on device OR server (post-wipe store is empty)

import { describe, it, expect } from 'vitest';
import { performWipe, type WipeInput } from '../src/wipe.js';
import type { Identifiable } from '../src/import-package.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

function seedStore(): WipeInput['store'] {
  const rows = (ids: string[]): Identifiable[] =>
    ids.map((id) => ({ id, text: `${id}-text` }));
  return {
    messages: rows(['m1', 'm2', 'm3']),
    claims: rows(['c1', 'c2']),
    sources: rows(['s1']),
    memories: rows(['mem1', 'mem2']),
    auditLog: rows(['a1', 'a2', 'a3', 'a4']),
    personas: rows(['yuki', 'kira']),
    settings: { theme: 'paper', autonomyLevel: 2 },
    files: rows(['f1']),
    embeddings: rows(['emb1', 'emb2']),
    pushSubscriptions: rows(['ps1']),
    syncCopies: rows(['sync1']),
    kvRegistry: rows(['kv1']),
  };
}

// =============================================================================
// Happy path
// =============================================================================

describe('performWipe — happy path', () => {
  it('correct confirm wipes all collections', () => {
    const input: WipeInput = {
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0,
    };
    const result = performWipe(input);
    expect(result.wiped).toBe(true);
    expect(result.reason).toBe('ok');
    for (const key of [
      'messages',
      'claims',
      'sources',
      'memories',
      'auditLog',
      'personas',
      'files',
      'embeddings',
      'pushSubscriptions',
      'syncCopies',
      'kvRegistry',
    ] as const) {
      expect(result.store[key]).toEqual([]);
    }
    expect(result.store.settings).toEqual({});
  });

  it('audit row records ONLY {at, action:"WIPE"} — never content', () => {
    const input: WipeInput = {
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0,
    };
    const result = performWipe(input);
    expect(result.auditRow).not.toBeNull();
    const row = result.auditRow!;
    expect(row.action).toBe('WIPE');
    expect(row.at).toBe('2026-10-02T12:00:00.000Z');
    expect(row.metadata).toEqual({});
    // The whole row, serialized, must never mention any id or content.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('m1');
    expect(serialized).not.toContain('yuki');
    expect(serialized).not.toContain('paper');
    expect(serialized).not.toContain('mem1');
  });

  it('id of the audit row is unique per wipe', () => {
    const a = performWipe({
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0,
    });
    const b = performWipe({
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0 + 1000,
    });
    expect(a.auditRow!.id).not.toBe(b.auditRow!.id);
  });
});

// =============================================================================
// Abort paths
// =============================================================================

describe('performWipe — abort paths', () => {
  it('confirm mismatch → nothing wiped', () => {
    const store = seedStore();
    const result = performWipe({
      profileId: 'p1',
      confirm: 'wrong',
      store,
      now: () => T0,
    });
    expect(result.wiped).toBe(false);
    expect(result.reason).toBe('confirm-mismatch');
    expect(result.auditRow).toBeNull();
    expect(result.store.messages.length).toBe(3);
    expect(result.store.claims.length).toBe(2);
  });

  it('empty profileId → nothing wiped', () => {
    const store = seedStore();
    const result = performWipe({
      profileId: '',
      confirm: '',
      store,
      now: () => T0,
    });
    expect(result.wiped).toBe(false);
    expect(result.reason).toBe('profile-mismatch');
    expect(result.auditRow).toBeNull();
    expect(result.store.messages.length).toBe(3);
  });
});

// =============================================================================
// Recoverability proof
// =============================================================================

describe('performWipe — no recoverable data', () => {
  it('post-wipe store has zero rows in every collection', () => {
    const result = performWipe({
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0,
    });
    const totals = Object.values(result.store).reduce((sum, v) => {
      if (Array.isArray(v)) return sum + v.length;
      if (v && typeof v === 'object') return sum + Object.keys(v).length;
      return sum;
    }, 0);
    expect(totals).toBe(0);
  });

  it('the original store object is not mutated (function is pure over input)', () => {
    const store = seedStore();
    const snapshot = JSON.stringify(store);
    performWipe({
      profileId: 'p1',
      confirm: 'p1',
      store,
      now: () => T0,
    });
    expect(JSON.stringify(store)).toBe(snapshot);
  });

  it('no id from any original row appears in the post-wipe store', () => {
    const result = performWipe({
      profileId: 'p1',
      confirm: 'p1',
      store: seedStore(),
      now: () => T0,
    });
    const serialized = JSON.stringify(result.store);
    for (const ghost of [
      'm1', 'm2', 'm3',
      'c1', 'c2',
      's1',
      'mem1', 'mem2',
      'a1', 'a2', 'a3', 'a4',
      'yuki', 'kira',
      'f1', 'emb1', 'emb2',
      'ps1', 'sync1', 'kv1',
      'paper', 'autonomyLevel',
    ]) {
      expect(serialized).not.toContain(ghost);
    }
  });
});
// === FILE END ===