// packages/cost-guard/src/allowlist.ts
// The default egress policy, seeded from PRD 4.1 (free endpoints) and 4.3
// (search endpoints). Billing paths and hosts are hard-denied by name
// (PRD 12.7 Layer 1).

import type { AllowRule, EgressPolicy } from './types.js';

/**
 * Free endpoints a single-user Aura-lie deployment may call outbound.
 * Every entry here has a corresponding row in PRD 4.1 / 4.3.
 */
export const DEFAULT_ALLOW: AllowRule[] = [
  // --- PRD 4.1 model providers (free tiers only) ----------------------
  { host: 'api.groq.com' },
  { host: 'generativelanguage.googleapis.com' },
  { host: 'api.cloudflare.com' },
  { host: 'api.openrouter.ai' },
  { host: 'api.cerebras.ai' },
  { host: 'api.mistral.ai' },
  { host: 'integrate.api.nvidia.com' },
  { host: 'models.inference.ai.azure.com' },

  // --- PRD 4.3 search and verification sources --------------------------
  { host: 'en.wikipedia.org' },
  { host: 'www.wikidata.org' },
  { host: 'query.wikidata.org' },
  { host: 'export.arxiv.org' },
  { host: 'api.crossref.org' },
  { host: 'eutils.ncbi.nlm.nih.gov' },
  { host: 'api.tavily.com' },
  { host: 'api.exa.ai' },
  { host: 'google.serper.dev' },
  { host: 'r.jina.ai' },

  // --- PRD 4.3 weather + Telegram ------------------------------------
  { host: 'api.open-meteo.com' },
  { host: 'api.telegram.org' },
];

/** Hosts that must never be called, regardless of allow-list. */
export const DEFAULT_DENY_HOSTS: string[] = [
  'api.stripe.com',
  'checkout.stripe.com',
  'dashboard.stripe.com',
  'api.braintreegateway.com',
  'api.paypal.com',
  'api-m.paypal.com',
  'connect.squareup.com',
  'api.squareup.com',
  'billing.cloudflare.com',
];

/** Path substrings that mark an endpoint as billing/upgrade/payment. */
export const DEFAULT_DENY_PATH_SUBSTRINGS: string[] = [
  '/billing',
  '/upgrade',
  '/payment',
  '/subscribe',
  '/checkout',
  '/topup',
  '/purchase',
  '/add-credits',
  '/add_credits',
  '/admin',
];

export function buildDefaultPolicy(): EgressPolicy {
  return {
    allow: DEFAULT_ALLOW.map((r) => ({ ...r, paths: r.paths?.slice() })),
    deny: {
      hosts: DEFAULT_DENY_HOSTS.slice(),
      pathSubstrings: DEFAULT_DENY_PATH_SUBSTRINGS.slice(),
    },
  };
}

/**
 * Host matcher: exact match, or `*.suffix` wildcard (which also matches the
 * bare suffix — `*.cloudflare.com` matches `cloudflare.com` and any subdomain).
 */
export function hostMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith('.' + suffix);
  }
  return false;
}

/**
 * Path-prefix matcher. `undefined` allow-list means "all paths on this host".
 */
export function pathAllowed(rule: AllowRule, pathname: string): boolean {
  if (!rule.paths || rule.paths.length === 0) return true;
  return rule.paths.some((p) => pathname.startsWith(p));
}

export interface EgressMatch {
  allowed: boolean;
  reason?: string;
  rule?: AllowRule;
}

export function evaluateEgress(policy: EgressPolicy, url: URL): EgressMatch {
  // Deny-list first — a billed host can never be reached even if the host
  // is on the allow-list (PRD 12.7 Layer 1: "denied by name").
  for (const host of policy.deny.hosts) {
    if (hostMatches(host, url.host)) {
      return { allowed: false, reason: `host ${url.host} is on the deny-list` };
    }
  }

  for (const substring of policy.deny.pathSubstrings) {
    if (url.pathname.includes(substring)) {
      return {
        allowed: false,
        reason: `path ${url.pathname} matches billing deny-pattern ${substring}`,
      };
    }
  }

  for (const rule of policy.allow) {
    if (hostMatches(rule.host, url.host) && pathAllowed(rule, url.pathname)) {
      return { allowed: true, rule };
    }
  }

  return { allowed: false, reason: `host ${url.host} is not on the allow-list` };
}