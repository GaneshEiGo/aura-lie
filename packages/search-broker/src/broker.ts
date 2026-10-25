// packages/search-broker/src/broker.ts
// PRD 8.5 — the Search Broker.

import { SearchLedger } from './ledger.js';
import { VerifyLaterQueue } from './queue.js';
import { routePools } from './router.js';
import type {
  BrokerAttempt,
  BrokerClaim,
  PoolId,
  SearchProvider,
  SourceResult,
  VerificationSummary,
  VerifyOutcome,
} from './types.js';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const INDIAN_MOBILE_RE = /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/;
const INTL_PHONE_RE = /\+\d{1,3}[\s-]?\d{6,14}\b/;
const CARD_RE = /\b(?:\d{4}[ -]?){3}\d{4}\b/;

export function looksLikePii(text: string): boolean {
  return (
    EMAIL_RE.test(text) ||
    INDIAN_MOBILE_RE.test(text) ||
    INTL_PHONE_RE.test(text) ||
    CARD_RE.test(text)
  );
}

export class SearchBroker {
  private readonly provider: SearchProvider;
  private readonly ledger: SearchLedger;
  private readonly queue: VerifyLaterQueue;

  constructor(
    provider: SearchProvider,
    ledger: SearchLedger,
    queue: VerifyLaterQueue = new VerifyLaterQueue(),
  ) {
    this.provider = provider;
    this.ledger = ledger;
    this.queue = queue;
  }

  async verify(claim: BrokerClaim): Promise<VerifyOutcome> {
    // Tier 0: no verification at all (PRD 8.6).
    if (claim.riskTier === 0) {
      return {
        claimId: claim.claimId,
        status: 'skipped-tier-0',
        poolsTried: [],
        sources: [],
        attempts: [],
      };
    }

    // Defense-in-depth: PII in claim text requires explicit consent (L7).
    if (looksLikePii(claim.text) && !claim.userApprovedExternalSearch) {
      return {
        claimId: claim.claimId,
        status: 'consent-required',
        poolsTried: [],
        sources: [],
        attempts: [],
        reason: 'claim contains possible personal information',
      };
    }

    // S2 sensitivity (PRD 12.3).
    if (claim.sensitivity === 'S2' && !claim.userApprovedExternalSearch) {
      return {
        claimId: claim.claimId,
        status: 'consent-required',
        poolsTried: [],
        sources: [],
        attempts: [],
        reason: 'S2 claim requires explicit consent for external search',
      };
    }

    const pools = routePools(claim);
    if (pools.length === 0) {
      return {
        claimId: claim.claimId,
        status: 'no-route',
        poolsTried: [],
        sources: [],
        attempts: [],
      };
    }

    const minSources = claim.minSources ?? 1;
    const attempts: BrokerAttempt[] = [];
    const sources: SourceResult[] = [];
    const poolsTried: PoolId[] = [];
    let anyActuallyChecked = false;
    let anyQuotaSkipped = false;

    for (const poolId of pools) {
      if (sources.length >= minSources) break;
      poolsTried.push(poolId);

      const reserve = this.ledger.tryReserve(poolId, 1);
      if (!reserve.ok) {
        attempts.push({
          poolId,
          outcome:
            reserve.reason === 'throttled' ? 'skipped-throttle' : 'skipped-quota',
          reason: reserve.reason,
          at: this.ledger.now(),
        });
        if (reserve.reason !== 'throttled') anyQuotaSkipped = true;
        continue;
      }

      try {
        const result = await this.provider.search(poolId, claim.text);
        // The charge stands whether the search returned a source or not;
        // we made the call.
        if (result) {
          sources.push(result);
          attempts.push({
            poolId,
            outcome: 'success',
            at: this.ledger.now(),
          });
        } else {
          attempts.push({
            poolId,
            outcome: 'empty',
            at: this.ledger.now(),
          });
        }
        anyActuallyChecked = true;
      } catch (err) {
        this.ledger.refund(poolId);
        attempts.push({
          poolId,
          outcome: 'error',
          reason: err instanceof Error ? err.message : String(err),
          at: this.ledger.now(),
        });
      }
    }

    if (sources.length > 0) {
      return {
        claimId: claim.claimId,
        status: 'verified',
        poolsTried,
        sources,
        attempts,
      };
    }

    if (anyActuallyChecked) {
      // Some pool was really queried and found nothing.
      return {
        claimId: claim.claimId,
        status: 'unverified',
        poolsTried,
        sources,
        attempts,
      };
    }

    if (anyQuotaSkipped) {
      this.enqueue(claim);
      return {
        claimId: claim.claimId,
        status: 'recall-only',
        poolsTried,
        sources,
        attempts,
        reason: 'quota-exhausted',
      };
    }

    // Nothing else fit — treat as recall-only so the caller can retry later.
    this.enqueue(claim);
    return {
      claimId: claim.claimId,
      status: 'recall-only',
      poolsTried,
      sources,
      attempts,
    };
  }

  async verifyAll(claims: BrokerClaim[]): Promise<VerificationSummary> {
    const outcomes: VerifyOutcome[] = [];
    for (const claim of claims) {
      outcomes.push(await this.verify(claim));
    }
    return this.summarize(outcomes);
  }

  async tickVerifyLater(limit = 10): Promise<VerifyOutcome[]> {
    const batch = this.queue.take(limit);
    const results: VerifyOutcome[] = [];
    for (const item of batch) {
      const outcome = await this.verify({
        claimId: item.claimId,
        text: item.text,
        kind: item.kind,
        riskTier: item.riskTier,
        sensitivity: item.sensitivity,
        minSources: item.minSources,
        userApprovedExternalSearch: item.userApprovedExternalSearch,
      });
      results.push(outcome);
    }
    return results;
  }

  peekQueueSize(): number {
    return this.queue.size();
  }

  private enqueue(claim: BrokerClaim): void {
    this.queue.enqueue({
      claimId: claim.claimId,
      text: claim.text,
      kind: claim.kind,
      riskTier: claim.riskTier,
      sensitivity: claim.sensitivity,
      minSources: claim.minSources,
      userApprovedExternalSearch: claim.userApprovedExternalSearch,
      enqueuedAt: this.ledger.now(),
    });
  }

  private summarize(outcomes: VerifyOutcome[]): VerificationSummary {
    const checkable = outcomes.length;
    const checked = outcomes.filter(
      (o) => o.status === 'verified' || o.status === 'unverified',
    ).length;
    const recallOnly = outcomes.filter((o) => o.status === 'recall-only').length;
    const consentRequired = outcomes.filter(
      (o) => o.status === 'consent-required',
    ).length;

    let message = `Checked ${checked} of ${checkable} claims.`;
    if (recallOnly > 0) message += ' Search quota is low.';
    if (consentRequired > 0) {
      message += ` ${consentRequired} claim${
        consentRequired > 1 ? 's' : ''
      } need${consentRequired > 1 ? '' : 's'} your approval.`;
    }

    return {
      outcomes,
      checked,
      checkable,
      recallOnly,
      consentRequired,
      message,
    };
  }
}