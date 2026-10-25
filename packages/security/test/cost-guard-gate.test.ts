// === FILE START ===
// packages/security/test/cost-guard-gate.test.ts
// PRD 12.7 · F-217 · L1 · T-01.
//
// Enforces the three-layer Cost Guard at test time:
//   1. recordViolation captures every blocked request with a stable id
//   2. auditIntegrity passes on valid logs and rejects malformed ones
//   3. monthlyReceipt's costInr is always exactly 0
// Plus the T-01 gate: 100 synthetic calls land where the allow-list dictates.

import { describe, it, expect } from 'vitest';
import { CostGuardAudit, formatMonthKey } from '../src/cost-guard-advanced.js';
import type { ViolationKind } from '../src/cost-guard-advanced.js';

function fixedClock(at: number): {
  clock: { now(): number };
  advance: (ms: number) => void;
} {
  let t = at;
  return {
    clock: { now: () => t },
    advance: (ms) => {
      t += ms;
    },
  };
}

function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

// =============================================================================
// recordViolation
// =============================================================================

describe('CostGuardAudit.recordViolation', () => {
  it('returns a well-formed record', () => {
    const audit = new CostGuardAudit();
    const rec = audit.recordViolation({
      kind: 'unapproved_host',
      adapter: 'groq',
      attemptedHost: 'evil.example.com',
      attemptedPath: '/steal',
      reason: 'host not in allow-list',
    });
    expect(rec.id).toMatch(/^v_/);
    expect(rec.kind).toBe('unapproved_host');
    expect(rec.adapter).toBe('groq');
    expect(rec.attemptedHost).toBe('evil.example.com');
    expect(rec.attemptedPath).toBe('/steal');
    expect(rec.reason).toBe('host not in allow-list');
    expect(typeof rec.at).toBe('number');
  });

  it('uses the injected clock for timestamps', () => {
    const { clock } = fixedClock(1_000_000);
    const audit = new CostGuardAudit({ clock });
    const rec = audit.recordViolation({
      kind: 'billing_endpoint',
      adapter: 'gemini',
      attemptedHost: 'api.stripe.com',
      reason: 'billing host denied',
    });
    expect(rec.at).toBe(1_000_000);
  });

  it('uses the injected id generator', () => {
    const audit = new CostGuardAudit({ idGenerator: sequentialIds('X') });
    const a = audit.recordViolation({
      kind: 'paid_model',
      adapter: 'openrouter',
      attemptedHost: 'openrouter.ai',
      reason: 'paid model',
    });
    const b = audit.recordViolation({
      kind: 'paid_tier',
      adapter: 'openrouter',
      attemptedHost: 'openrouter.ai',
      reason: 'paid tier',
    });
    expect(a.id).toBe('X1');
    expect(b.id).toBe('X2');
  });

  it('attemptedPath defaults to empty string', () => {
    const audit = new CostGuardAudit();
    const rec = audit.recordViolation({
      kind: 'insecure_protocol',
      adapter: 'groq',
      attemptedHost: 'groq.com',
      reason: 'http not allowed',
    });
    expect(rec.attemptedPath).toBe('');
  });

  it('violationLog returns clones (mutations do not affect state)', () => {
    const audit = new CostGuardAudit();
    audit.recordViolation({
      kind: 'unapproved_host',
      adapter: 'groq',
      attemptedHost: 'a.com',
      reason: 'r',
    });
    const log = audit.violationLog();
    log[0].reason = 'mutated';
    expect(audit.violationLog()[0].reason).toBe('r');
  });

  it('violationCount starts at 0 and increments per record', () => {
    const audit = new CostGuardAudit();
    expect(audit.violationCount()).toBe(0);
    audit.recordViolation({
      kind: 'unapproved_host',
      adapter: 'a',
      attemptedHost: 'h',
      reason: 'r',
    });
    expect(audit.violationCount()).toBe(1);
    audit.recordViolation({
      kind: 'billing_endpoint',
      adapter: 'b',
      attemptedHost: 'h',
      reason: 'r',
    });
    expect(audit.violationCount()).toBe(2);
  });
});

// =============================================================================
// summary
// =============================================================================

describe('CostGuardAudit.summary', () => {
  it('empty log returns zero totals', () => {
    const audit = new CostGuardAudit();
    const s = audit.summary();
    expect(s.total).toBe(0);
    expect(s.byKind.unapproved_host).toBe(0);
    expect(s.byKind.billing_endpoint).toBe(0);
    expect(s.byKind.insecure_protocol).toBe(0);
    expect(s.byKind.paid_model).toBe(0);
    expect(s.byKind.paid_tier).toBe(0);
    expect(Object.keys(s.byAdapter)).toEqual([]);
  });

  it('counts by kind correctly', () => {
    const audit = new CostGuardAudit();
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'billing_endpoint', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    const s = audit.summary();
    expect(s.total).toBe(3);
    expect(s.byKind.unapproved_host).toBe(2);
    expect(s.byKind.billing_endpoint).toBe(1);
    expect(s.byKind.paid_model).toBe(0);
  });

  it('counts by adapter correctly', () => {
    const audit = new CostGuardAudit();
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'groq', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'groq', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'gemini', attemptedHost: 'h', reason: 'r' });
    const s = audit.summary();
    expect(s.byAdapter.groq).toBe(2);
    expect(s.byAdapter.gemini).toBe(1);
  });

  it('total matches violationCount', () => {
    const audit = new CostGuardAudit();
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'paid_model', adapter: 'b', attemptedHost: 'h', reason: 'r' });
    expect(audit.summary().total).toBe(audit.violationCount());
  });
});

// =============================================================================
// auditIntegrity
// =============================================================================

describe('CostGuardAudit.auditIntegrity', () => {
  it('empty log passes', () => {
    const audit = new CostGuardAudit();
    const r = audit.auditIntegrity();
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('valid log passes', () => {
    const audit = new CostGuardAudit();
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'billing_endpoint', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    const r = audit.auditIntegrity();
    expect(r.ok).toBe(true);
    expect(r.uniqueIds).toBe(2);
    expect(r.hasFuture).toBe(false);
  });

  it('detects duplicate IDs', () => {
    const audit = new CostGuardAudit({ idGenerator: () => 'SAME' });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    const r = audit.auditIntegrity();
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('duplicate_id'))).toBe(true);
    expect(r.uniqueIds).toBe(1);
  });

  it('detects future timestamps', () => {
    // Clock that moves BACKWARD after the record is created.
    let t = 2_000_000;
    const clock = { now: () => t };
    const audit = new CostGuardAudit({ clock });
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    t = 1_000_000;
    const r = audit.auditIntegrity();
    expect(r.ok).toBe(false);
    expect(r.hasFuture).toBe(true);
    expect(r.reasons).toContain('future_timestamp');
  });
});

// =============================================================================
// monthlyReceipt
// =============================================================================

describe('CostGuardAudit.monthlyReceipt', () => {
  it('returns costInr === 0', () => {
    const audit = new CostGuardAudit();
    audit.recordReply();
    audit.recordReply();
    const r = audit.monthlyReceipt();
    expect(r.costInr).toBe(0);
  });

  it('uses the passed month', () => {
    const audit = new CostGuardAudit();
    const r = audit.monthlyReceipt('2026-10');
    expect(r.month).toBe('2026-10');
  });

  it('uses the current clock month when omitted', () => {
    const { clock } = fixedClock(Date.UTC(2026, 9, 2)); // October 2026
    const audit = new CostGuardAudit({ clock });
    const r = audit.monthlyReceipt();
    expect(r.month).toBe('2026-10');
  });

  it('label matches the PRD copy', () => {
    const audit = new CostGuardAudit();
    audit.recordReply();
    audit.recordReply();
    audit.recordReply();
    const r = audit.monthlyReceipt();
    expect(r.label).toBe('Rs 0.00 this month · 3 replies · 0 rupees, ever');
  });
});

// =============================================================================
// T-01 GATE — 100 synthetic calls
// =============================================================================

const APPROVED_HOSTS = new Set([
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'api.cloudflare.com',
  'openrouter.ai',
]);

const UNAPPROVED_HOSTS = [
  'evil.example.com',
  'attacker.test',
  'malware.example.org',
  'free-vpn.example.net',
  'dark-web.example',
];

const BILLING_HOSTS = ['api.stripe.com', 'billing.openai.com', 'payments.example'];

function simulateCall(
  audit: CostGuardAudit,
  host: string,
): { allowed: boolean; violationKind?: ViolationKind } {
  // Simulate the guarded-fetch decision tree.
  if (BILLING_HOSTS.includes(host)) {
    audit.recordViolation({
      kind: 'billing_endpoint',
      adapter: 'test',
      attemptedHost: host,
      reason: 'billing host denied by name',
    });
    return { allowed: false, violationKind: 'billing_endpoint' };
  }
  if (APPROVED_HOSTS.has(host)) {
    return { allowed: true };
  }
  audit.recordViolation({
    kind: 'unapproved_host',
    adapter: 'test',
    attemptedHost: host,
    reason: 'host not in allow-list',
  });
  return { allowed: false, violationKind: 'unapproved_host' };
}

describe('T-01 gate — 100 synthetic calls stay inside the allow-list', () => {
  it('100 approved-only calls → 0 violations, integrity passes', () => {
    const audit = new CostGuardAudit({ idGenerator: sequentialIds() });
    const approved = [...APPROVED_HOSTS];
    let violations = 0;
    for (let i = 0; i < 100; i++) {
      const host = approved[i % approved.length];
      const result = simulateCall(audit, host);
      if (!result.allowed) violations += 1;
      audit.recordReply();
    }
    expect(violations).toBe(0);
    expect(audit.violationCount()).toBe(0);
    expect(audit.auditIntegrity().ok).toBe(true);
    expect(audit.monthlyReceipt().costInr).toBe(0);
  });

  it('100 unapproved calls → 100 violations, integrity still passes', () => {
    const audit = new CostGuardAudit({ idGenerator: sequentialIds() });
    for (let i = 0; i < 100; i++) {
      simulateCall(audit, UNAPPROVED_HOSTS[i % UNAPPROVED_HOSTS.length]);
    }
    expect(audit.violationCount()).toBe(100);
    const integrity = audit.auditIntegrity();
    // A non-empty log is NOT an integrity failure. It means the guard blocked
    // 100 requests — exactly what T-01 wants.
    expect(integrity.ok).toBe(true);
    expect(integrity.total).toBe(100);
    expect(audit.monthlyReceipt().costInr).toBe(0);
  });

  it('50 approved + 50 unapproved → exactly 50 violations, byKind correct', () => {
    const audit = new CostGuardAudit({ idGenerator: sequentialIds() });
    for (let i = 0; i < 100; i++) {
      const host =
        i < 50
          ? [...APPROVED_HOSTS][i % APPROVED_HOSTS.size]
          : UNAPPROVED_HOSTS[(i - 50) % UNAPPROVED_HOSTS.length];
      simulateCall(audit, host);
    }
    const s = audit.summary();
    expect(s.total).toBe(50);
    expect(s.byKind.unapproved_host).toBe(50);
    expect(s.byKind.billing_endpoint).toBe(0);
    expect(audit.auditIntegrity().ok).toBe(true);
  });

  it('100 calls mixing billing + unapproved → all non-allowlisted blocked', () => {
    const audit = new CostGuardAudit({ idGenerator: sequentialIds() });
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        simulateCall(audit, BILLING_HOSTS[i % BILLING_HOSTS.length]);
      } else if (i % 3 === 0) {
        simulateCall(audit, UNAPPROVED_HOSTS[i % UNAPPROVED_HOSTS.length]);
      } else {
        simulateCall(audit, [...APPROVED_HOSTS][i % APPROVED_HOSTS.size]);
      }
    }
    const s = audit.summary();
    expect(s.byKind.billing_endpoint).toBe(10); // i%10===0 for i=0,10,…,90
    expect(s.total).toBe(audit.violationCount());
    // Every receipt across 100 calls still shows 0 rupees.
    expect(audit.monthlyReceipt().costInr).toBe(0);
  });
});

// =============================================================================
// recordReply + reset
// =============================================================================

describe('CostGuardAudit — reply tracking + reset', () => {
  it('recordReply increments the receipt reply count', () => {
    const audit = new CostGuardAudit();
    audit.recordReply();
    audit.recordReply();
    audit.recordReply();
    expect(audit.monthlyReceipt().replies).toBe(3);
  });

  it('reset clears the violation log and reply count', () => {
    const audit = new CostGuardAudit();
    audit.recordReply();
    audit.recordViolation({ kind: 'unapproved_host', adapter: 'a', attemptedHost: 'h', reason: 'r' });
    expect(audit.violationCount()).toBe(1);
    audit.reset();
    expect(audit.violationCount()).toBe(0);
    expect(audit.monthlyReceipt().replies).toBe(0);
  });
});

// =============================================================================
// formatMonthKey
// =============================================================================

describe('formatMonthKey', () => {
  it('formats January correctly', () => {
    expect(formatMonthKey(Date.UTC(2026, 0, 15))).toBe('2026-01');
  });
  it('formats December correctly', () => {
    expect(formatMonthKey(Date.UTC(2026, 11, 31))).toBe('2026-12');
  });
  it('pads single-digit months', () => {
    expect(formatMonthKey(Date.UTC(2026, 9, 2))).toBe('2026-10');
    expect(formatMonthKey(Date.UTC(2026, 2, 15))).toBe('2026-03');
  });
});
// === FILE END ===