// === FILE START ===
// packages/router-engine/src/route-v2.ts
// PRD 7.4 · 7.8 · FR-ROUTE-01 to FR-ROUTE-06 · FR-WF-01 · FR-WF-06 · T-14.
//
// The router pipeline. Takes a list of candidate models and a request, applies
// 5 hard filters in order, then soft-scores the survivors and picks the best.
//
// Hard filters (order matters — first failure wins, candidate is dropped):
//   1. role_mismatch       — candidate must list the requested role
//   2. sensitivity_lane    — S2 requires private lane
//   3. context_window      — candidate context must fit prompt; also reject if
//                            prompt > 60% of candidate's rpmTokens
//   4. capability_missing  — candidate must have every required capability
//   5. diversity_conflict  — judge must be from a different family than drafter
//   6. breaker_open        — circuit breaker open (unless cooldown has elapsed)
//   7. headroom_low        — pool headroom < 10%
//   8. excluded            — caller excluded this modelId
//
// Soft score (higher = better):
//   capability_fit × headroom × health × latency_fit × diversity_bonus
//
// The selected model is the highest-scored survivor. If none survives, the
// decision is null and the reason lists every rejection.
//
// Deterministic and dependency-free. Same input always produces same output.

export type Lane = 'private' | 'training-risk';
export type Sensitivity = 'S0' | 'S1' | 'S2';
export type Capability =
  | 'reasoning'
  | 'vision'
  | 'json'
  | 'tools'
  | 'long-context';
export type Role =
  | 'fast'
  | 'reasoner'
  | 'judge'
  | 'vision'
  | 'utility'
  | 'embedder'
  | 'long-context';
export type Family = string;
export type LatencyTier = 'fast' | 'medium' | 'slow';
export type LatencyPreference = 'fast' | 'balanced' | 'quality';

export interface ModelCandidate {
  id: string;
  family: Family;
  lane: Lane;
  roles: Role[];
  contextWindow: number;
  rpmTokens: number;
  capabilities: Capability[];
  latencyTier: LatencyTier;
  capabilityFit: number; // 0..1 from Aura-Bench routing table
}

export interface RoutingRequest {
  sensitivity: Sensitivity;
  promptTokens: number;
  requiredRole: Role;
  requiredCapabilities?: Capability[];
  latencyPreference?: LatencyPreference;
  diversityFrom?: Family;
  excludedModelIds?: string[];
}

export interface BreakerSnapshot {
  modelId: string;
  state: 'closed' | 'open' | 'half-open';
  openedAt: number | null;
}

export interface PoolHeadroomEntry {
  pool: string;
  used: number;
  limit: number;
}

export interface SelectRouteOptions {
  breakers: BreakerSnapshot[];
  headroom: PoolHeadroomEntry[];
  now: number;
  breakerCooldownMs?: number;
}

export interface ModelSelection {
  candidate: ModelCandidate;
  score: number;
  reasons: string[];
}

export type HardFilterReason =
  | 'role_mismatch'
  | 'sensitivity_lane'
  | 'context_window'
  | 'capability_missing'
  | 'diversity_conflict'
  | 'breaker_open'
  | 'headroom_low'
  | 'excluded';

export interface RejectedCandidate {
  candidate: ModelCandidate;
  reason: HardFilterReason;
}

export interface RouteDecision {
  selection: ModelSelection | null;
  rejected: RejectedCandidate[];
  reason: string;
}

const DEFAULT_COOLDOWN_MS = 90_000;
const HEADROOM_THRESHOLD = 0.1;
const CONTEXT_TOKEN_RATIO = 0.6;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function findBreaker(
  breakers: BreakerSnapshot[],
  modelId: string,
): BreakerSnapshot | null {
  for (const b of breakers) if (b.modelId === modelId) return b;
  return null;
}

function headroomFor(headroom: PoolHeadroomEntry[], family: Family): number {
  for (const h of headroom) {
    if (h.pool === family) {
      if (h.limit <= 0) return 0;
      return Math.max(0, (h.limit - h.used) / h.limit);
    }
  }
  // Unknown pool → assume unlimited
  return 1.0;
}

function latencyFit(
  candidateTier: LatencyTier,
  pref: LatencyPreference,
): number {
  if (pref === 'fast') {
    return candidateTier === 'fast' ? 1 : candidateTier === 'medium' ? 0.6 : 0.2;
  }
  if (pref === 'quality') {
    return candidateTier === 'slow' ? 1 : candidateTier === 'medium' ? 0.7 : 0.5;
  }
  return candidateTier === 'medium' ? 1 : candidateTier === 'fast' ? 0.8 : 0.8;
}

function isBreakerOpen(
  breaker: BreakerSnapshot | null,
  now: number,
  cooldownMs: number,
): boolean {
  if (!breaker) return false;
  if (breaker.state === 'open') {
    if (breaker.openedAt !== null && now - breaker.openedAt >= cooldownMs) {
      // Cooldown elapsed → allow probe (half-open behaviour)
      return false;
    }
    return true;
  }
  return false;
}

function breakerHealth(breaker: BreakerSnapshot | null): number {
  if (!breaker) return 1;
  if (breaker.state === 'closed') return 1;
  if (breaker.state === 'half-open') return 0.5;
  return 0.8;
}

// -----------------------------------------------------------------------------
// selectRoute — the public selector
// -----------------------------------------------------------------------------

export function selectRoute(
  candidates: ModelCandidate[],
  req: RoutingRequest,
  opts: SelectRouteOptions,
): RouteDecision {
  const cooldown = opts.breakerCooldownMs ?? DEFAULT_COOLDOWN_MS;
  const rejected: RejectedCandidate[] = [];
  const passed: ModelCandidate[] = [];

  for (const c of candidates) {
    // 1. Role
    if (!c.roles.includes(req.requiredRole)) {
      rejected.push({ candidate: c, reason: 'role_mismatch' });
      continue;
    }

    // 2. Sensitivity lane
    if (req.sensitivity === 'S2' && c.lane !== 'private') {
      rejected.push({ candidate: c, reason: 'sensitivity_lane' });
      continue;
    }

    // 3. Context window
    if (c.contextWindow < req.promptTokens) {
      rejected.push({ candidate: c, reason: 'context_window' });
      continue;
    }
    if (
      c.rpmTokens > 0 &&
      req.promptTokens > c.rpmTokens * CONTEXT_TOKEN_RATIO
    ) {
      rejected.push({ candidate: c, reason: 'context_window' });
      continue;
    }

    // 4. Required capabilities
    if (req.requiredCapabilities && req.requiredCapabilities.length > 0) {
      let missing = false;
      for (const cap of req.requiredCapabilities) {
        if (!c.capabilities.includes(cap)) {
          missing = true;
          break;
        }
      }
      if (missing) {
        rejected.push({ candidate: c, reason: 'capability_missing' });
        continue;
      }
    }

    // 5. Diversity — judge must differ from drafter family
    if (req.diversityFrom && c.family === req.diversityFrom) {
      rejected.push({ candidate: c, reason: 'diversity_conflict' });
      continue;
    }

    // 6. Breaker
    const breaker = findBreaker(opts.breakers, c.id);
    if (isBreakerOpen(breaker, opts.now, cooldown)) {
      rejected.push({ candidate: c, reason: 'breaker_open' });
      continue;
    }

    // 7. Headroom
    if (headroomFor(opts.headroom, c.family) < HEADROOM_THRESHOLD) {
      rejected.push({ candidate: c, reason: 'headroom_low' });
      continue;
    }

    // 8. Excluded
    if (req.excludedModelIds && req.excludedModelIds.includes(c.id)) {
      rejected.push({ candidate: c, reason: 'excluded' });
      continue;
    }

    passed.push(c);
  }

  if (passed.length === 0) {
    return {
      selection: null,
      rejected,
      reason: `No candidate passed hard filters (${rejected.length} rejected)`,
    };
  }

  // Soft score
  const pref = req.latencyPreference ?? 'balanced';
  const scored: Array<{
    c: ModelCandidate;
    score: number;
    reasons: string[];
  }> = [];

  for (const c of passed) {
    const reasons: string[] = [];

    const capabilityFit = Math.max(0, Math.min(1, c.capabilityFit));
    reasons.push(`capability_fit=${capabilityFit.toFixed(2)}`);

    const headroom = headroomFor(opts.headroom, c.family);
    reasons.push(`headroom=${headroom.toFixed(2)}`);

    const breaker = findBreaker(opts.breakers, c.id);
    const health = breakerHealth(breaker);
    reasons.push(`health=${health.toFixed(2)}`);

    const lFit = latencyFit(c.latencyTier, pref);
    reasons.push(`latency_fit=${lFit.toFixed(2)}`);

    const diversityBonus =
      req.diversityFrom && c.family !== req.diversityFrom ? 1.1 : 1.0;
    reasons.push(`diversity_bonus=${diversityBonus.toFixed(2)}`);

    const score = capabilityFit * headroom * health * lFit * diversityBonus;
    scored.push({ c, score, reasons });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker: lexicographic modelId (deterministic)
    return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
  });

  const winner = scored[0];

  return {
    selection: {
      candidate: winner.c,
      score: winner.score,
      reasons: winner.reasons,
    },
    rejected,
    reason: `Selected ${winner.c.id} (family=${winner.c.family}, score=${winner.score.toFixed(3)})`,
  };
}
// === FILE END ===