// packages/cost-guard/test/cost-guard.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildDefaultPolicy,
  hostMatches,
  evaluateEgress,
  guardedFetch,
  scanSource,
  scanTree,
  ZeroCostLedger,
  ViolationLogger,
  CostGuardViolationError,
  monthlyReceipt,
  renderMonthlyReceipt,
  noCardAudit,
} from '../src/index.js';
import type { FetchLike } from '../src/types.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function fixedClock(at: number): { now(): number } {
  return { now: () => at };
}

const policy = buildDefaultPolicy();

function fakeFetch(): { impl: FetchLike; calls: number } {
  const state = { impl: null as unknown as FetchLike, calls: 0 };
  state.impl = async () => {
    state.calls += 1;
    return new Response('ok', { status: 200 });
  };
  return state as any;
}

// -----------------------------------------------------------------------------
describe('Cost Guard (PRD 4.7, 12.7, T-01, F-217)', () => {
  // ---- Host matching ------------------------------------------------
  it('hostMatches: exact match', () => {
    expect(hostMatches('api.groq.com', 'api.groq.com')).toBe(true);
    expect(hostMatches('api.groq.com', 'api.groq.evil.com')).toBe(false);
  });

  it('hostMatches: wildcard matches bare and subdomains', () => {
    expect(hostMatches('*.cloudflare.com', 'api.cloudflare.com')).toBe(true);
    expect(hostMatches('*.cloudflare.com', 'cloudflare.com')).toBe(true);
    expect(hostMatches('*.cloudflare.com', 'evil.com')).toBe(false);
  });

  // ---- Egress evaluation --------------------------------------------
  it('accepts a Groq chat completion path', () => {
    const url = new URL('https://api.groq.com/v1/chat/completions');
    expect(evaluateEgress(policy, url).allowed).toBe(true);
  });

  it('accepts a Wikipedia query path', () => {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    expect(evaluateEgress(policy, url).allowed).toBe(true);
  });

  it('rejects an unknown host', () => {
    const url = new URL('https://evil.example.com/api');
    const r = evaluateEgress(policy, url);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not on the allow-list/);
  });

  it('rejects Stripe even if someone tries to allow it', () => {
    const url = new URL('https://api.stripe.com/v1/charges');
    const r = evaluateEgress(policy, url);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/deny-list/);
  });

  it('rejects a /billing path on an allow-listed host', () => {
    const url = new URL('https://api.groq.com/billing/upgrade');
    const r = evaluateEgress(policy, url);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/billing deny-pattern/);
  });

  it('rejects a /checkout path on Cloudflare', () => {
    const url = new URL('https://api.cloudflare.com/checkout');
    expect(evaluateEgress(policy, url).allowed).toBe(false);
  });

  // ---- guardedFetch: happy path ------------------------------------
  it('guardedFetch calls the underlying fetch when allowed', async () => {
    const fake = fakeFetch();
    const res = await guardedFetch(
      'https://api.groq.com/v1/chat/completions',
      undefined,
      policy,
      { fetchImpl: fake.impl },
    );
    expect(res.status).toBe(200);
    expect(fake.calls).toBe(1);
  });

  // ---- guardedFetch: denied hosts ---------------------------------
  it('guardedFetch throws on a denied host and logs the violation', async () => {
    const fake = fakeFetch();
    const logger = new ViolationLogger();
    await expect(
      guardedFetch('https://evil.example.com/x', undefined, policy, {
        fetchImpl: fake.impl,
        logger,
        adapter: 'test-adapter',
        clock: fixedClock(1000),
      }),
    ).rejects.toBeInstanceOf(CostGuardViolationError);
    expect(fake.calls).toBe(0);
    expect(logger.byKind('denied-host').length).toBe(1);
    expect(logger.all()[0].adapter).toBe('test-adapter');
    expect(logger.all()[0].at).toBe(1000);
  });

  it('guardedFetch throws on a billing endpoint and logs the violation', async () => {
    const fake = fakeFetch();
    const logger = new ViolationLogger();
    await expect(
      guardedFetch('https://api.stripe.com/v1/charges', undefined, policy, {
        fetchImpl: fake.impl,
        logger,
        adapter: 'test-adapter',
      }),
    ).rejects.toMatchObject({ kind: 'billing-endpoint' });
    expect(fake.calls).toBe(0);
    expect(logger.byKind('billing-endpoint').length).toBe(1);
  });

  it('guardedFetch throws on /billing on an allowed host', async () => {
    const fake = fakeFetch();
    await expect(
      guardedFetch('https://api.groq.com/billing/upgrade', undefined, policy, {
        fetchImpl: fake.impl,
      }),
    ).rejects.toMatchObject({ kind: 'billing-endpoint' });
    expect(fake.calls).toBe(0);
  });

  it('guardedFetch accepts a URL object', async () => {
    const fake = fakeFetch();
    const res = await guardedFetch(
      new URL('https://api.groq.com/v1/models'),
      undefined,
      policy,
      { fetchImpl: fake.impl },
    );
    expect(res.status).toBe(200);
  });

  // ---- Layer 2 CI scan ---------------------------------------------
  it('scanSource detects a stripe import', () => {
    const violations = scanSource(
      `import Stripe from 'stripe';`,
      'app.ts',
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].kind).toBe('paid-sdk');
    expect(violations[0].file).toBe('app.ts');
  });

  it('scanSource detects @stripe/* imports', () => {
    const violations = scanSource(
      `import { Webhook } from '@stripe/webhooks';`,
      'webhook.ts',
    );
    expect(violations.some((v) => v.kind === 'paid-sdk')).toBe(true);
  });

  it('scanSource detects paid env vars', () => {
    const violations = scanSource(
      `const key = process.env.STRIPE_SECRET_KEY;`,
      'keys.ts',
    );
    expect(violations.some((v) => v.kind === 'paid-env')).toBe(true);
  });

  it('scanSource detects { paid: true } on a model', () => {
    const violations = scanSource(
      `{"model":"gpt-4","paid":true}`,
      'models.json',
    );
    expect(violations.some((v) => v.kind === 'paid-model-flag')).toBe(true);
  });

  it('scanSource returns nothing for clean code', () => {
    const violations = scanSource(
      `import { guardedFetch } from '@aura-lie/cost-guard';\nexport const ok = true;\n`,
      'clean.ts',
    );
    expect(violations.length).toBe(0);
  });

  it('scanTree aggregates violations across files', () => {
    const violations = scanTree([
      { path: 'a.ts', code: `import Stripe from 'stripe';` },
      { path: 'b.json', code: `{"paid":true}` },
      { path: 'clean.ts', code: `export {}` },
    ]);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some((v) => v.file === 'a.ts')).toBe(true);
    expect(violations.some((v) => v.file === 'b.json')).toBe(true);
  });

  // ---- Layer 3 ledger ----------------------------------------------
  it('ledger accepts a zero-cost row', () => {
    const logger = new ViolationLogger();
    const ledger = new ZeroCostLedger({
      logger,
      clock: fixedClock(2000),
    });
    const row = ledger.recordCall({
      at: 2000,
      provider: 'groq',
      model: 'llama-3.3-70b',
      tokens: 250,
      costInr: 0,
    });
    expect(row.costInr).toBe(0);
    expect(ledger.size()).toBe(1);
    expect(ledger.totalCostInr()).toBe(0);
    expect(logger.size()).toBe(0);
  });

  it('ledger rejects a non-zero cost and logs it', () => {
    const logger = new ViolationLogger();
    const ledger = new ZeroCostLedger({
      logger,
      clock: fixedClock(3000),
    });
    expect(() =>
      ledger.recordCall({
        at: 3000,
        provider: 'groq',
        model: 'llama-3.3-70b',
        tokens: 250,
        costInr: 0.01,
      }),
    ).toThrow(CostGuardViolationError);
    expect(ledger.size()).toBe(0);
    const violations = logger.byKind('non-zero-cost');
    expect(violations.length).toBe(1);
    expect(violations[0].host).toBe('groq');
    expect(violations[0].at).toBe(3000);
  });

  // ---- Monthly receipt ---------------------------------------------
  it('monthly receipt is always Rs 0.00', () => {
    const receipt = monthlyReceipt({
      month: '2026-10',
      replies: 4312,
      calls: 12000,
    });
    expect(receipt.costInr).toBe(0);
    expect(renderMonthlyReceipt(receipt)).toBe(
      'Rs 0.00 this month · 4312 replies · 0 rupees, ever',
    );
  });

  // ---- No-card audit -----------------------------------------------
  it('no-card audit flags non-verified providers', () => {
    const audit = noCardAudit([
      { provider: 'groq', verified: 'verified', checkedAt: 1 },
      { provider: 'gemini', verified: 'not-verified', checkedAt: 1 },
      { provider: 'cloudflare', verified: 'verified', checkedAt: 1 },
    ]);
    expect(audit.allVerified).toBe(false);
    expect(audit.failedProviders).toEqual(['gemini']);
  });

  it('no-card audit is clean when all providers are verified', () => {
    const audit = noCardAudit([
      { provider: 'groq', verified: 'verified', checkedAt: 1 },
      { provider: 'gemini', verified: 'verified', checkedAt: 1 },
    ]);
    expect(audit.allVerified).toBe(true);
    expect(audit.failedProviders).toEqual([]);
  });

  // ---- CostGuardViolationError carries context ---------------------
  it('CostGuardViolationError carries kind, host, reason, at', () => {
    const err = new CostGuardViolationError({
      kind: 'denied-host',
      host: 'evil.example.com',
      reason: 'host is not on the allow-list',
      at: 999,
    });
    expect(err.kind).toBe('denied-host');
    expect(err.host).toBe('evil.example.com');
    expect(err.reason).toMatch(/allow-list/);
    expect(err.at).toBe(999);
    expect(err.name).toBe('CostGuardViolationError');
  });
});