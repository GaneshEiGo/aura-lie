// packages/truth-pipeline/src/verify-turn.ts
// PRD 8.3 pipeline: extract → broker → judge → score.

import { scoreClaim } from '@aura-lie/truth';
import type { ClaimStatus } from '@aura-lie/truth';
import type {
  BrokerClaim,
  ExtractedClaim,
  JudgeVerdict,
  VerificationInput,
  VerificationResult,
  VerifiedClaim,
  VerifiedSource,
  VerifyTurnDeps,
} from './types.js';
import { extractClaims } from './claim-extractor.js';
import { mapClaimToKind, tierForPool, hostOf } from './sources.js';
import { computeFactors } from './factors.js';
import { runJudge } from './judge.js';

export async function verifyTurn(
  input: VerificationInput,
  deps: VerifyTurnDeps,
): Promise<VerificationResult> {
  const claims = extractClaims(input.text, input.maxClaims);
  const checkable = claims.length;

  if (checkable === 0) {
    return { claims: [], checked: 0, checkable: 0 };
  }

  // PRD 8.6: tier 0 → no verification
  if (input.features.riskTier === 0) {
    return {
      claims: claims.map((c) => toUnscored(c)),
      checked: 0,
      checkable,
    };
  }

  const verified: VerifiedClaim[] = [];
  for (const claim of claims) {
    try {
      verified.push(await verifyOne(claim, input, deps));
    } catch {
      verified.push(toUnscored(claim));
    }
  }

  const checked = verified.filter((c) => c.score !== null).length;
  return { claims: verified, checked, checkable };
}

async function verifyOne(
  claim: ExtractedClaim,
  input: VerificationInput,
  deps: VerifyTurnDeps,
): Promise<VerifiedClaim> {
  const brokerClaim: BrokerClaim = {
    claimId: claim.id,
    text: claim.text,
    kind: mapClaimToKind(claim.type),
    riskTier: input.features.riskTier,
    sensitivity: input.features.sensitivityHint,
  };

  const outcome = await deps.broker.verify(brokerClaim);

  if (outcome.status === 'recall-only') {
    return toUnscored(claim, 'RECALL_ONLY');
  }
  if (outcome.status === 'consent-required' || outcome.status === 'no-route') {
    return toUnscored(claim, 'UNVERIFIED');
  }
  if (!outcome.sources || outcome.sources.length === 0) {
    return toUnscored(claim, 'UNVERIFIED');
  }

  const verifiedSources: VerifiedSource[] = [];
  const stances: JudgeVerdict[] = [];

  for (let i = 0; i < outcome.sources.length; i++) {
    const src = outcome.sources[i];
    const passage = src.snippet ?? src.title ?? '';
    if (!passage) continue;

    const judged = await runJudge({
      candidates: deps.judgeCandidates,
      judgeFn: deps.judgeFn,
      claim: claim.text,
      passage,
      drafterFamily: deps.drafterFamily,
      breakers: deps.breakers,
      clock: deps.clock,
    });
    if (!judged) continue;

    const verdict = judged.verdict;
    const matchOk = !!verdict.quote && passage.includes(verdict.quote);

    verifiedSources.push({
      id: `${src.poolId}-${i + 1}`,
      title: src.title ?? src.url,
      domain: hostOf(src.url),
      tier: tierForPool(src.poolId),
      independenceGroup: src.poolId,
      quote: verdict.quote ?? '',
      matchOk,
    });
    stances.push(verdict);
  }

  if (verifiedSources.length === 0) {
    return toUnscored(claim, 'UNVERIFIED');
  }

  const factors = computeFactors({
    claim,
    sources: verifiedSources,
    stances,
  });

  const quoteVerified = verifiedSources.every((s) => s.matchOk);

  const scored = scoreClaim({
    id: claim.id,
    text: claim.text,
    importance: claim.importanceScore,
    factors,
    hasSource: true,
    isQuoteVerified: quoteVerified,
    isInterestedParty: false,
  });

  return {
    id: claim.id,
    text: claim.text,
    type: claim.type,
    importance: claim.importanceScore,
    score: scored.score,
    status: scored.status,
    factors: factors as unknown as Record<string, number>,
    capsApplied: scored.capsApplied,
    sources: verifiedSources,
  };
}

function toUnscored(
  claim: ExtractedClaim,
  status: ClaimStatus = 'NOT_SCORED',
): VerifiedClaim {
  return {
    id: claim.id,
    text: claim.text,
    type: claim.type,
    importance: claim.importanceScore,
    score: null,
    status,
    factors: {},
    capsApplied: [],
    sources: [],
  };
}