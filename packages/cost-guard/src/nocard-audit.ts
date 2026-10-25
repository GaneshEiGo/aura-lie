// packages/cost-guard/src/nocard-audit.ts
// H.5 No-Card Law checklist.

import type { NoCardAuditResult, ProviderNoCardCheck } from './types.js';

/**
 * Consumers provide the results of their monthly billing-page inspection.
 * This module is the single source of truth for "all verified → clean".
 */
export function noCardAudit(
  providers: ProviderNoCardCheck[],
): NoCardAuditResult {
  const failedProviders = providers
    .filter((p) => p.verified === 'not-verified')
    .map((p) => p.provider);

  return {
    providers: providers.map((p) => ({ ...p })),
    allVerified: failedProviders.length === 0,
    failedProviders,
  };
}