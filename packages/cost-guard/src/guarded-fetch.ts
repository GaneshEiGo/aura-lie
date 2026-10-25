// packages/cost-guard/src/guarded-fetch.ts
// PRD 4.7 §2 + 12.7 Layer 1: "A single guarded Fetch wrapper is the only
// way to make outbound calls. Anything else is blocked before the network."

import type { EgressPolicy, FetchLike } from './types.js';
import { evaluateEgress } from './allowlist.js';
import { CostGuardViolationError, ViolationLogger } from './violations.js';

export interface GuardedFetchOptions {
  fetchImpl?: FetchLike;
  logger?: ViolationLogger;
  adapter?: string;
  clock?: { now(): number };
}

/**
 * The only supported way to make outbound calls. Never throws on network
 * failure (defers to the wrapped fetch); throws `CostGuardViolationError`
 * on a policy rejection and logs the violation.
 */
export async function guardedFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  policy: EgressPolicy,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const clock = options.clock ?? { now: () => Date.now() };
  const adapter = options.adapter ?? 'unknown';
  const logger = options.logger;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let urlString: string;
  if (typeof input === 'string') urlString = input;
  else if (input instanceof URL) urlString = input.toString();
  else urlString = input.url;

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    const err = new CostGuardViolationError({
      kind: 'denied-host',
      host: urlString,
      reason: 'malformed URL',
      at: clock.now(),
    });
    logger?.record({
      at: err.at,
      adapter,
      host: urlString,
      reason: err.reason,
      kind: err.kind,
    });
    throw err;
  }

  const match = evaluateEgress(policy, parsed);
  if (!match.allowed) {
    const kind =
      match.reason?.startsWith('host') && match.reason.includes('deny-list')
        ? 'billing-endpoint'
        : match.reason?.startsWith('path')
          ? 'billing-endpoint'
          : 'denied-host';
    const err = new CostGuardViolationError({
      kind,
      host: parsed.host,
      reason: match.reason ?? 'blocked by policy',
      at: clock.now(),
    });
    logger?.record({
      at: err.at,
      adapter,
      host: err.host,
      reason: err.reason,
      kind: err.kind,
    });
    throw err;
  }

  return fetchImpl(input as any, init);
}