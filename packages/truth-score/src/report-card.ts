// === FILE START ===
// packages/truth-score/src/report-card.ts
// PRD FR-TRUTH-12 · FR-TRUTH-18 · 5.6 · 8.7 · T-32.
//
// The Evidence Report Card inside Inspector → Facts:
//   Evidence, Sources, Freshness, Reasoning check, Completeness
//   + Action safety (only when actions exist)
//
// Invariants:
//   · Every non-null score is provable from the input. If a bar cannot be
//     computed, `score: null` and `color: 'grey'` — never a fabricated 0.
//   · `actionSafety` is null when no actions are provided.
//   · `wouldStrengthen[]` merges every claim's advice, deduped, capped at 5.

import type { FactPillClaim } from './fact-pill.js';

export type BarColor = 'ok' | 'warn' | 'bad' | 'grey';

export interface ReportBar {
  id: 'evidence' | 'sources' | 'freshness' | 'reasoning' | 'completeness' | 'actionSafety';
  label: string;
  /** 0..1, or null when the bar cannot be computed from the input. */
  score: number | null;
  /** One-sentence human description of the score. */
  note: string;
  color: BarColor;
}

export interface ActionInput {
  safety: 'safe' | 'needs_approval' | 'blocked';
}

export interface ReportCardInput {
  claims: FactPillClaim[];
  /** Critic result. Undefined means "not run". */
  criticResult?: 'pass' | 'fail';
  /** 0..1. Undefined or null means "not evaluated". */
  completenessScore?: number | null;
  /** Actions to review. Undefined or empty means "no actions exist". */
  actions?: ActionInput[];
}

export interface ReportCard {
  evidence: ReportBar;
  sources: ReportBar;
  freshness: ReportBar;
  reasoning: ReportBar;
  completeness: ReportBar;
  actionSafety: ReportBar | null;
  /** Merged "what would make this stronger" across every claim. */
  wouldStrengthen: string[];
}

function barColor(score: number): BarColor {
  if (score >= 0.85) return 'ok';
  if (score >= 0.5) return 'warn';
  return 'bad';
}

export function assembleReportCard(input: ReportCardInput): ReportCard {
  const { claims, criticResult, completenessScore, actions } = input;

  // -------- Evidence bar -----------------------------------------------------
  // "How many scored claims have at least one verified quote?"
  const scored = claims.filter((c) => c.verdict.score !== null);
  const scoredCount = scored.length;

  const scoredWithEvidence = scored.filter((c) =>
    c.verdict.evidence.some((e) => e.quoteVerified),
  );
  const evidenceScore =
    scoredCount === 0 ? null : scoredWithEvidence.length / scoredCount;
  const evidenceNote =
    scoredCount === 0
      ? 'No claims to score'
      : `${scoredWithEvidence.length} of ${scoredCount} claims have a verified quote`;

  // -------- Sources bar ------------------------------------------------------
  // "How many distinct verified sources were used? (target = 3 per PRD 8.7)"
  const verifiedSourceIds = new Set<string>();
  for (const c of claims) {
    for (const e of c.verdict.evidence) {
      if (e.quoteVerified) verifiedSourceIds.add(e.sourceId);
    }
  }
  const distinctSources = verifiedSourceIds.size;
  const sourcesScore = distinctSources === 0 ? 0 : Math.min(1, distinctSources / 3);
  const sourcesNote =
    distinctSources === 0
      ? 'No verified sources'
      : `${distinctSources} distinct source${distinctSources === 1 ? '' : 's'} (3 target)`;

  // -------- Freshness bar ----------------------------------------------------
  // "How many scored claims are NOT stale?"
  const staleCount = scored.filter((c) => c.verdict.caps.includes('stale')).length;
  const freshnessScore =
    scoredCount === 0 ? null : 1 - staleCount / scoredCount;
  const freshnessNote =
    scoredCount === 0
      ? 'No claims to score'
      : `${scoredCount - staleCount} of ${scoredCount} claims are fresh`;

  // -------- Reasoning check bar ---------------------------------------------
  // "Did the critic pass?" — the caller supplies this from the critic run.
  const reasoningScore =
    criticResult === 'pass' ? 1 : criticResult === 'fail' ? 0 : null;
  const reasoningNote =
    criticResult === 'pass'
      ? 'Critic passed'
      : criticResult === 'fail'
        ? 'Critic found issues'
        : 'Critic did not run';

  // -------- Completeness bar -------------------------------------------------
  // "Did the answer address every part of the question?"
  const completenessScoreVal =
    typeof completenessScore === 'number' ? completenessScore : null;
  const completenessNote =
    completenessScoreVal === null
      ? 'Not evaluated'
      : `Answer addressed ${Math.round(completenessScoreVal * 100)}% of parts`;

  // -------- Action safety bar (conditional) ---------------------------------
  let actionSafety: ReportBar | null = null;
  if (actions && actions.length > 0) {
    const scores = actions.map((a) =>
      a.safety === 'safe' ? 1 : a.safety === 'needs_approval' ? 0.5 : 0,
    );
    const actionScore = scores.reduce((s, x) => s + x, 0) / scores.length;
    const safeCount = actions.filter((a) => a.safety === 'safe').length;
    const approveCount = actions.filter((a) => a.safety === 'needs_approval').length;
    const blockedCount = actions.filter((a) => a.safety === 'blocked').length;
    const parts: string[] = [];
    if (safeCount > 0) parts.push(`${safeCount} safe`);
    if (approveCount > 0) parts.push(`${approveCount} needs approval`);
    if (blockedCount > 0) parts.push(`${blockedCount} blocked`);
    actionSafety = {
      id: 'actionSafety',
      label: 'Action safety',
      score: actionScore,
      note: parts.join(', ') || 'No actions',
      color: barColor(actionScore),
    };
  }

  // -------- wouldStrengthen aggregation -------------------------------------
  // Union every claim's advice, dedupe by exact string, cap at 5.
  const seen = new Set<string>();
  const wouldStrengthen: string[] = [];
  outer: for (const c of claims) {
    for (const s of c.verdict.wouldStrengthen) {
      if (seen.has(s)) continue;
      seen.add(s);
      wouldStrengthen.push(s);
      if (wouldStrengthen.length >= 5) break outer;
    }
  }

  return {
    evidence: {
      id: 'evidence',
      label: 'Evidence',
      score: evidenceScore,
      note: evidenceNote,
      color: evidenceScore === null ? 'grey' : barColor(evidenceScore),
    },
    sources: {
      id: 'sources',
      label: 'Sources',
      score: sourcesScore,
      note: sourcesNote,
      color: barColor(sourcesScore),
    },
    freshness: {
      id: 'freshness',
      label: 'Freshness',
      score: freshnessScore,
      note: freshnessNote,
      color: freshnessScore === null ? 'grey' : barColor(freshnessScore),
    },
    reasoning: {
      id: 'reasoning',
      label: 'Reasoning check',
      score: reasoningScore,
      note: reasoningNote,
      color: reasoningScore === null ? 'grey' : barColor(reasoningScore),
    },
    completeness: {
      id: 'completeness',
      label: 'Completeness',
      score: completenessScoreVal,
      note: completenessNote,
      color: completenessScoreVal === null ? 'grey' : barColor(completenessScoreVal),
    },
    actionSafety,
    wouldStrengthen,
  };
}
// === FILE END ===