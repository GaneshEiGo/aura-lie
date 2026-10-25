// === FILE START ===
// packages/truth-score/src/pipeline.ts
// PRD 8.3 · F-031 to F-038 · FR-TRUTH-06 to FR-TRUTH-13 · T-06 · Section 82.

import { verifyQuoteSpan } from './quote-span.js';
import { scoreClaim } from './score.js';
import { analyzeConflicts } from './conflict.js';
import { analyzeConflicts } from './conflict.js'; // NEW (Section 82)
import {
  determineGlyph,
  glyphMeaning,
  getWouldStrengthen,
  computeConcordance,
  computeEvidenceStrength,
  type ClaimVerdict,
  type Evidence,
} from './verdict.js';
import type {
  ClaimStatus,
  ClaimVolatility,
  ScoreClaimInput,
  Source,
  SourceTier,
} from './types.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface ClaimInput {
  claimId: string;
  text: string;
  checkable: boolean;
  checked: boolean;
  volatility: ClaimVolatility;
  halfLifeDays?: number;
}

export interface FetchedSource {
  id: string;
  url: string;
  title: string;
  pageText: string;
  tier: SourceTier;
  ageDays: number;
  independenceKey: string;
  retrievedAt: string;
}

export interface JudgeResponse {
  stance: 'supports' | 'contradicts' | 'neutral';
  span: string;
  rationale: string;
}

export interface JudgeCall {
  sourceId: string;
  response: JudgeResponse;
}

export interface PipelineResult {
  verdict: ClaimVerdict;
  trace: string[];
}

// -----------------------------------------------------------------------------
// Tier helper
// -----------------------------------------------------------------------------

function isStrongSource(tier: SourceTier): boolean {
  return tier === 'primary' || tier === 'peerReviewed' || tier === 'reputable';
}

// -----------------------------------------------------------------------------
// processJudgeResponse
// -----------------------------------------------------------------------------

export function processJudgeResponse(
  source: FetchedSource,
  judge: JudgeResponse,
  evidenceId: string,
): Evidence {
  const verification = verifyQuoteSpan(source.pageText, judge.span);
  const quoteVerified = verification.verified;
  const effectiveStance: Evidence['stance'] = quoteVerified
    ? judge.stance
    : 'neutral';

  return {
    id: evidenceId,
    sourceId: source.id,
    sourceTitle: source.title,
    sourceUrl: source.url,
    sourceTier: source.tier,
    stance: effectiveStance,
    quote: quoteVerified ? judge.span : null,
    quoteVerified,
    matchKind: verification.matchKind,
    retrievedAt: source.retrievedAt,
  };
}

// -----------------------------------------------------------------------------
// Aggregation helpers
// -----------------------------------------------------------------------------

function computeQuoteVerifiedStatus(
  evidence: Evidence[],
): boolean | null {
  let anyFailed = false;
  let anyVerified = false;
  for (const e of evidence) {
    if (
      e.matchKind === 'paraphrase' ||
      e.matchKind === 'not_found' ||
      e.matchKind === 'too_long'
    ) {
      anyFailed = true;
    }
    if (e.quoteVerified) anyVerified = true;
  }
  if (anyFailed) return false;
  if (anyVerified) return true;
  return null;
}

function computeEntailment(evidence: Evidence[]): number | null {
  let anyFailed = false;
  let supports = 0;
  let contradicts = 0;
  let neutrals = 0;
  for (const e of evidence) {
    if (
      e.matchKind === 'paraphrase' ||
      e.matchKind === 'not_found' ||
      e.matchKind === 'too_long'
    ) {
      anyFailed = true;
    }
    if (!e.quoteVerified) continue;
    if (e.stance === 'supports') supports++;
    else if (e.stance === 'contradicts') contradicts++;
    else neutrals++;
  }
  if (anyFailed) return 0;
  if (supports > 0) return 100;
  if (contradicts > 0) return 0;
  if (neutrals > 0) return 30;
  return null;
}

function computeAgreement(evidence: Evidence[]): number | null {
  if (evidence.length === 0) return null;
  const supports = evidence.filter(
    (e) => e.stance === 'supports' && e.quoteVerified,
  ).length;
  return Math.round((supports / evidence.length) * 100);
}

function computeContradiction(
  evidence: Evidence[],
): 'strong' | 'weak' | null {
  let weak = false;
  for (const e of evidence) {
    if (e.stance !== 'contradicts' || !e.quoteVerified) continue;
    if (isStrongSource(e.sourceTier)) return 'strong';
    weak = true;
  }
  return weak ? 'weak' : null;
}

// -----------------------------------------------------------------------------
// buildVerdict
// -----------------------------------------------------------------------------

export function buildVerdict(
  claim: ClaimInput,
  sources: FetchedSource[],
  judgeCalls: JudgeCall[],
): ClaimVerdict {
  if (!claim.checkable) {
    return makeTerminalVerdict(
      claim,
      'NOT_SCORED',
      null,
      ['not_checkable'],
      0,
      false,
      [],
    );
  }

  if (!claim.checked) {
    return makeTerminalVerdict(
      claim,
      'RECALL_ONLY',
      null,
      ['not_checked'],
      0,
      false,
      [],
    );
  }

  const sourceById = new Map<string, FetchedSource>();
  for (const s of sources) sourceById.set(s.id, s);

  const evidence: Evidence[] = [];
  for (let i = 0; i < judgeCalls.length; i++) {
    const call = judgeCalls[i];
    const source = sourceById.get(call.sourceId);
    if (!source) continue;
    evidence.push(
      processJudgeResponse(source, call.response, `${claim.claimId}-ev-${i}`),
    );
  }

  const seen = new Set<string>();
  const usedSources: Source[] = [];
  for (const s of sources) {
    if (seen.has(s.independenceKey)) continue;
    seen.add(s.independenceKey);
    usedSources.push({
      tier: s.tier,
      ageDays: s.ageDays,
      independenceKey: s.independenceKey,
    });
  }

  const quoteVerifiedStatus = computeQuoteVerifiedStatus(evidence);
  const entailment = computeEntailment(evidence);
  const agreement = computeAgreement(evidence);
  const contradiction = computeContradiction(evidence);

  const scoreInput: ScoreClaimInput = {
    checkable: claim.checkable,
    checked: claim.checked,
    sources: usedSources,
    entailment,
    agreement,
    consistency: null,
    quoteVerified: quoteVerifiedStatus,
    contradiction,
    volatility: claim.volatility,
    halfLifeDays: claim.halfLifeDays,
  };

  const scoreResult = scoreClaim(scoreInput);

  const concordance = computeConcordance(evidence);
  const evidenceStrength = computeEvidenceStrength(concordance);
  const glyph = determineGlyph(scoreResult.status, scoreResult.score);
  const wouldStrengthen = getWouldStrengthen(
    scoreResult.caps,
    scoreResult.score,
  );

  const verdict: ClaimVerdict = {
    claimId: claim.claimId,
    claimText: claim.text,
    status: scoreResult.status,
    score: scoreResult.score,
    evidence,
    caps: scoreResult.caps,
    penalty: scoreResult.penalty,
    partialCheck: scoreResult.partialCheck,
    wouldStrengthen,
    glyph,
    glyphMeaning: glyphMeaning(glyph),
    concordance,
    evidenceStrength,
  };

  // NEW (Section 82): attach conflict analysis when the status is CONFLICTED.
  if (verdict.status === 'CONFLICTED') {
    verdict.conflictAnalysis = analyzeConflicts(verdict);
  }

  return verdict;
}

// -----------------------------------------------------------------------------
// makeTerminalVerdict
// -----------------------------------------------------------------------------

function makeTerminalVerdict(
  claim: ClaimInput,
  status: ClaimStatus,
  score: number | null,
  caps: string[],
  penalty: number,
  partialCheck: boolean,
  evidence: Evidence[],
): ClaimVerdict {
  const glyph = determineGlyph(status, score);
  const concordance = computeConcordance(evidence);
  const evidenceStrength = computeEvidenceStrength(concordance);
  return {
    claimId: claim.claimId,
    claimText: claim.text,
    status,
    score,
    evidence,
    caps,
    penalty,
    partialCheck,
    wouldStrengthen: getWouldStrengthen(caps, score),
    glyph,
    glyphMeaning: glyphMeaning(glyph),
    concordance,
    evidenceStrength,
    conflictAnalysis: null,
  };
}

// -----------------------------------------------------------------------------
// runPipeline
// -----------------------------------------------------------------------------

export function runPipeline(
  claim: ClaimInput,
  sources: FetchedSource[],
  judgeCalls: JudgeCall[],
): PipelineResult {
  const trace: string[] = [];
  trace.push(
    `[plan] claim=${claim.claimId} checkable=${claim.checkable} checked=${claim.checked} ` +
      `sources=${sources.length} judges=${judgeCalls.length}`,
  );

  if (!claim.checkable) {
    trace.push(`[label] NOT_SCORED — opinion/creative/instruction`);
    return { verdict: buildVerdict(claim, sources, judgeCalls), trace };
  }
  if (!claim.checked) {
    trace.push(`[label] RECALL_ONLY — checked=false`);
    return { verdict: buildVerdict(claim, sources, judgeCalls), trace };
  }

  const sourceById = new Map<string, FetchedSource>();
  for (const s of sources) sourceById.set(s.id, s);

  for (let i = 0; i < judgeCalls.length; i++) {
    const call = judgeCalls[i];
    const source = sourceById.get(call.sourceId);
    if (!source) {
      trace.push(`[warn] orphaned judge call for source=${call.sourceId}`);
      continue;
    }
    const ev = processJudgeResponse(
      source,
      call.response,
      `${claim.claimId}-ev-${i}`,
    );
    trace.push(
      `[quote-span] source=${source.id} matchKind=${ev.matchKind} ` +
        `verified=${ev.quoteVerified} stance=${ev.stance}`,
    );
  }

  const verdict = buildVerdict(claim, sources, judgeCalls);

  trace.push(
    `[score] raw=${verdict.score} caps=[${verdict.caps.join(',')}] ` +
      `penalty=${verdict.penalty} → ${verdict.score} ${verdict.status}`,
  );
  trace.push(
    `[label] glyph=${verdict.glyph || '(none)'} meaning=${verdict.glyphMeaning} ` +
      `strength=${verdict.evidenceStrength}`,
  );
  if (verdict.conflictAnalysis) {
    trace.push(
      `[conflict] cause=${verdict.conflictAnalysis.cause} ` +
        `resolution=${verdict.conflictAnalysis.resolution.kind} ` +
        `confidence=${verdict.conflictAnalysis.confidence}`,
    );
  }

  return { verdict, trace };
}
// === FILE END ===