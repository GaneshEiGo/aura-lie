// packages/kill-switch-audit/test/kill-switch-audit.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  sha256Hex,
  canonicalStringify,
  hashRow,
  hashInput,
  verifyChain,
  HashChainedAuditLog,
  KillSwitch,
  KillSwitchActiveError,
  GENESIS_HASH,
  AUDIT_RETENTION_DAYS,
} from '../src/index.js';
import type {
  AuditEntry,
  KillSwitchState,
} from '../src/index.js';

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

const DAY_MS = 86_400_000;

// -----------------------------------------------------------------------------
describe('SHA-256 (F-285)', () => {
  // Known-answer tests from FIPS 180-4.
  it('sha256Hex("") matches FIPS-180-4 vector', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('sha256Hex("abc") matches FIPS-180-4 vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256Hex("The quick brown fox…") matches FIPS-180-4 vector', () => {
    expect(
      sha256Hex('The quick brown fox jumps over the lazy dog'),
    ).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('sha256Hex is deterministic', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
    expect(sha256Hex('hello')).not.toBe(sha256Hex('world'));
  });

  it('sha256Hex produces 64 lowercase hex characters', () => {
    const h = sha256Hex('anything');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Canonical serialization (F-285 determinism)', () => {
  it('canonicalStringify sorts object keys', () => {
    const a = canonicalStringify({ b: 2, a: 1 });
    const b = canonicalStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('canonicalStringify preserves array order', () => {
    expect(canonicalStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalStringify([3, 2, 1])).toBe('[3,2,1]');
  });

  it('canonicalStringify handles nested objects deterministically', () => {
    const a = canonicalStringify({ x: { c: 3, a: 1 }, y: [1, { b: 2, a: 1 }] });
    const b = canonicalStringify({ y: [1, { a: 1, b: 2 }], x: { a: 1, c: 3 } });
    expect(a).toBe(b);
  });

  it('canonicalStringify handles null and undefined', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBe(undefined as any);
  });
});

describe('Hash-chained audit log (PRD 10.10, F-083, F-285)', () => {
  // ---- Basics --------------------------------------------------
  it('starts empty with GENESIS_HASH head', () => {
    const log = new HashChainedAuditLog();
    expect(log.size()).toBe(0);
    expect(log.headHash()).toBe(GENESIS_HASH);
  });

  it('records one entry with sequential ids', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const e = log.record({
      action: 'tool_call',
      actor: 'u1',
      reason: 'calculator',
    });
    expect(e.id).toBe('audit-00000001');
    expect(log.size()).toBe(1);
    const e2 = log.record({
      action: 'memory_write',
      actor: 'u1',
      reason: 'remember tea',
    });
    expect(e2.id).toBe('audit-00000002');
  });

  it('rejects entries with an empty actor', () => {
    const log = new HashChainedAuditLog();
    expect(() =>
      log.record({ action: 'tool_call', actor: '', reason: 'x' }),
    ).toThrow(/actor/);
  });

  it('rejects entries with an empty reason', () => {
    const log = new HashChainedAuditLog();
    expect(() =>
      log.record({ action: 'tool_call', actor: 'u1', reason: '' }),
    ).toThrow(/reason/);
  });

  it('fills defaults for optional fields', () => {
    const { clock } = fixedClock(5_000);
    const log = new HashChainedAuditLog({ clock });
    const e = log.record({
      action: 'tool_call',
      actor: 'u1',
      reason: 'r',
    });
    expect(e.tool).toBe('');
    expect(e.outputSummary).toBe('');
    expect(e.result).toBe('success');
    expect(e.approvals).toEqual([]);
    expect(e.at).toBe(5_000);
  });

  it('inputHash is deterministic and never the raw payload', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const payload = { claim: 'A', source: 'B' };
    const a = log.record({
      action: 'tool_call',
      actor: 'u1',
      reason: 'r',
      inputPayload: payload,
    });
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.inputHash).toBe(hashInput(payload));
    // The raw payload never appears in the audit entry.
    expect(JSON.stringify(a)).not.toContain('"claim"');
  });

  it('inputHash defaults to GENESIS_HASH when no payload', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const e = log.record({ action: 'wipe', actor: 'u1', reason: 'user asked' });
    expect(e.inputHash).toBe(GENESIS_HASH);
  });

  // ---- Chaining (F-285) ----------------------------------------
  it('first entry chains to GENESIS_HASH', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const e = log.record({ action: 'tool_call', actor: 'u1', reason: 'r' });
    expect(e.prevHash).toBe(GENESIS_HASH);
  });

  it('subsequent entries chain to the prior hash', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const a = log.record({ action: 'tool_call', actor: 'u1', reason: 'a' });
    const b = log.record({ action: 'tool_call', actor: 'u1', reason: 'b' });
    expect(b.prevHash).toBe(a.hash);
    const c = log.record({ action: 'tool_call', actor: 'u1', reason: 'c' });
    expect(c.prevHash).toBe(b.hash);
  });

  it('headHash updates on each record', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const a = log.record({ action: 'tool_call', actor: 'u1', reason: 'a' });
    expect(log.headHash()).toBe(a.hash);
  });

  // ---- verifyChain integrity -----------------------------------
  it('verifyChain passes for an intact chain', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    for (let i = 0; i < 5; i++) {
      log.record({ action: 'tool_call', actor: 'u1', reason: `r${i}` });
    }
    const result = log.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.count).toBe(5);
  });

  it('verifyChain passes for the empty log', () => {
    const log = new HashChainedAuditLog();
    expect(log.verifyChain()).toEqual({ valid: true, count: 0 });
  });

  it('verifyChain detects a tampered reason', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'original' });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'second' });

    const tampered = log.all().map((e) =>
      e.id === 'audit-00000001' ? { ...e, reason: 'hacked' } : e,
    );
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('audit-00000001');
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('verifyChain detects a tampered hash', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'r' });
    const tampered = log.all().map((e) => ({
      ...e,
      hash: 'f'.repeat(64),
    }));
    expect(verifyChain(tampered).valid).toBe(false);
  });

  it('verifyChain detects a broken prevHash link', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'a' });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'b' });
    const tampered = log.all().map((e) =>
      e.id === 'audit-00000002'
        ? { ...e, prevHash: '0'.repeat(64) }
        : e,
    );
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('audit-00000002');
    expect(result.reason).toMatch(/prevHash mismatch/);
  });

  it('a tampered earlier entry invalidates every later hash check', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    for (let i = 0; i < 3; i++) {
      log.record({ action: 'tool_call', actor: 'u1', reason: `r${i}` });
    }
    const tampered = log.all().map((e) =>
      e.id === 'audit-00000002'
        ? { ...e, outputSummary: 'faked' }
        : e,
    );
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('audit-00000002');
  });

  // ---- Query helpers (PRD 10.10 "Searchable") -----------------
  it('byAction filters entries by action', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'a' });
    log.record({ action: 'memory_write', actor: 'u1', reason: 'b' });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'c' });

    const tools = log.byAction('tool_call');
    expect(tools.length).toBe(2);
    expect(tools.every((e) => e.action === 'tool_call')).toBe(true);
  });

  it('byActor filters entries by actor', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'alice', reason: 'a' });
    log.record({ action: 'tool_call', actor: 'bob', reason: 'b' });
    log.record({ action: 'tool_call', actor: 'alice', reason: 'c' });

    const alice = log.byActor('alice');
    expect(alice.length).toBe(2);
    expect(alice.every((e) => e.actor === 'alice')).toBe(true);
  });

  it('search accepts a predicate', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({
      action: 'tool_call',
      actor: 'u1',
      reason: 'a',
      result: 'success',
    });
    log.record({
      action: 'tool_call',
      actor: 'u1',
      reason: 'b',
      result: 'blocked',
    });
    const blocked = log.search((e) => e.result === 'blocked');
    expect(blocked.length).toBe(1);
  });

  // ---- Retention (PRD 10.10 "Kept 400 days") ------------------
  it('AUDIT_RETENTION_DAYS is 400 (PRD 10.10)', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(400);
  });

  it('pruneOlderThan deletes entries past the retention window', () => {
    const { clock, add } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'old' });
    add(410 * DAY_MS);
    log.record({ action: 'tool_call', actor: 'u1', reason: 'recent' });
    expect(log.size()).toBe(2);
    const pruned = log.pruneOlderThan(AUDIT_RETENTION_DAYS);
    expect(pruned).toBe(1);
    expect(log.size()).toBe(1);
    expect(log.all()[0].reason).toBe('recent');
  });

  it('pruneOlderThan leaves recent entries untouched', () => {
    const { clock, add } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'recent' });
    add(10 * DAY_MS);
    expect(log.pruneOlderThan(AUDIT_RETENTION_DAYS)).toBe(0);
    expect(log.size()).toBe(1);
  });

  it('pruneOlderThan resets head to GENESIS_HASH when all entries removed', () => {
    const { clock, add } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'old' });
    add(500 * DAY_MS);
    log.pruneOlderThan(AUDIT_RETENTION_DAYS);
    expect(log.size()).toBe(0);
    expect(log.headHash()).toBe(GENESIS_HASH);
  });

  // ---- Serialization -------------------------------------------
  it('AuditEntry survives JSON round-trip', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const e = log.record({
      action: 'approval_granted',
      actor: 'u1',
      reason: 'user approved file creation',
      approvals: ['appr-1', 'appr-2'],
    });
    const roundtripped = JSON.parse(JSON.stringify(e)) as AuditEntry;
    expect(roundtripped.id).toBe(e.id);
    expect(roundtripped.approvals).toEqual(['appr-1', 'appr-2']);
    expect(roundtripped.hash).toBe(e.hash);
  });

  it('all() returns clones (mutation-safe)', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({ action: 'tool_call', actor: 'u1', reason: 'a' });
    const entries = log.all();
    (entries[0] as AuditEntry).reason = 'mutated';
    expect(log.all()[0].reason).toBe('a');
  });

  it('approvals array is cloned on record', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const approvals = ['a', 'b'];
    const e = log.record({
      action: 'approval_granted',
      actor: 'u1',
      reason: 'r',
      approvals,
    });
    approvals.push('c');
    expect(e.approvals).toEqual(['a', 'b']);
  });
});

describe('Kill switch (PRD 10.4, 10.10, F-082, T-10)', () => {
  // ---- Default state -------------------------------------------
  it('starts active (not paused)', () => {
    const ks = new KillSwitch();
    expect(ks.isActive()).toBe(false);
    expect(ks.canRun()).toBe(true);
  });

  it('honours initial state overrides', () => {
    const ks = new KillSwitch({
      initial: { paused: true, reason: 'debug' },
    });
    expect(ks.isActive()).toBe(true);
  });

  // ---- pause / resume ------------------------------------------
  it('pause sets the flag and records pausedAt/pausedBy', async () => {
    const { clock } = fixedClock(1_000);
    const ks = new KillSwitch({ clock });
    await ks.pause('u1', 'user tapped pause');
    expect(ks.isActive()).toBe(true);
    const snap = ks.snapshot();
    expect(snap.pausedAt).toBe(1_000);
    expect(snap.pausedBy).toBe('u1');
    expect(snap.reason).toBe('user tapped pause');
  });

  it('pause is idempotent', async () => {
    const ks = new KillSwitch();
    await ks.pause('u1', 'first');
    await ks.pause('u1', 'second');
    expect(ks.snapshot().reason).toBe('first');
  });

  it('resume clears the flag', async () => {
    const ks = new KillSwitch();
    await ks.pause('u1', 'r');
    await ks.resume('u1', 'resume');
    expect(ks.isActive()).toBe(false);
    expect(ks.canRun()).toBe(true);
    expect(ks.snapshot().pausedAt).toBeNull();
  });

  it('resume is idempotent', async () => {
    const ks = new KillSwitch();
    await ks.resume('u1', 'nothing to do');
    expect(ks.isActive()).toBe(false);
  });

  // ---- runIfActive / assertActive ------------------------------
  it('runIfActive runs the function when active', async () => {
    const ks = new KillSwitch();
    const fn = vi.fn(() => 42);
    const result = await ks.runIfActive(fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });

  it('runIfActive returns null when paused', async () => {
    const ks = new KillSwitch();
    await ks.pause('u1', 'r');
    const fn = vi.fn(() => 42);
    const result = await ks.runIfActive(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('assertActive throws when paused', async () => {
    const ks = new KillSwitch();
    await ks.pause('u1', 'stop');
    expect(() => ks.assertActive()).toThrow(KillSwitchActiveError);
    expect(() => ks.assertActive()).toThrow(/stop/);
  });

  it('assertActive is a no-op when active', () => {
    const ks = new KillSwitch();
    expect(() => ks.assertActive()).not.toThrow();
  });

  // ---- Hooks ---------------------------------------------------
  it('pause fires registered hooks', async () => {
    const ks = new KillSwitch();
    const hook = vi.fn();
    ks.onPause(hook);
    await ks.pause('u1', 'r');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('pause fires all hooks in registration order', async () => {
    const ks = new KillSwitch();
    const order: number[] = [];
    ks.onPause(() => {
      order.push(1);
    });
    ks.onPause(async () => {
      order.push(2);
    });
    ks.onPause(() => {
      order.push(3);
    });
    await ks.pause('u1', 'r');
    expect(order).toEqual([1, 2, 3]);
  });

  it('a hook that throws does not block pause', async () => {
    const ks = new KillSwitch();
    ks.onPause(() => {
      throw new Error('hook 1 boom');
    });
    const second = vi.fn();
    ks.onPause(second);
    await ks.pause('u1', 'r');
    expect(ks.isActive()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
  });

  it('returned unsubscribe removes the hook', async () => {
    const ks = new KillSwitch();
    const hook = vi.fn();
    const unsubscribe = ks.onPause(hook);
    unsubscribe();
    await ks.pause('u1', 'r');
    expect(hook).not.toHaveBeenCalled();
  });

  // ---- T-10 acceptance -----------------------------------------
  it('T-10: pause blocks the next operation immediately', async () => {
    const ks = new KillSwitch();
    await ks.pause('u1', 'user tapped pause');
    // The very next guard check refuses.
    expect(ks.canRun()).toBe(false);
    expect(ks.isActive()).toBe(true);
    const op = vi.fn(() => 'ran');
    expect(await ks.runIfActive(op)).toBeNull();
    expect(op).not.toHaveBeenCalled();
  });

  // ---- Audit integration --------------------------------------
  it('pause and resume write audit entries when an audit sink is provided', async () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    const ks = new KillSwitch({ clock, audit: log });

    await ks.pause('u1', 'user tapped pause');
    await ks.resume('u1', 'user tapped resume');

    expect(log.size()).toBe(2);
    expect(log.byAction('kill_switch_pause').length).toBe(1);
    expect(log.byAction('kill_switch_resume').length).toBe(1);
  });

  it('a Cost Guard violation is written as a distinct action (PRD 12.7)', () => {
    const { clock } = fixedClock(1_000);
    const log = new HashChainedAuditLog({ clock });
    log.record({
      action: 'cost_guard_violation',
      actor: 'system',
      reason: 'attempted billing host api.stripe.com',
      inputPayload: { host: 'api.stripe.com', adapter: 'groq' },
      result: 'blocked',
      outputSummary: 'blocked before network',
    });
    const violations = log.byAction('cost_guard_violation');
    expect(violations.length).toBe(1);
    expect(violations[0].result).toBe('blocked');
    expect(violations[0].hash).toMatch(/^[0-9a-f]{64}$/);
    // Chain remains valid.
    expect(log.verifyChain().valid).toBe(true);
  });
});