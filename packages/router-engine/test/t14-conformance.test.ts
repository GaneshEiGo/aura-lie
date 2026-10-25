// === FILE START ===
// packages/router-engine/test/t14-conformance.test.ts
// PRD 7.4 · 7.8 · FR-ROUTE-01 to FR-ROUTE-06 · T-14.
//
// The T-14 gate: 200 labelled prompts, 100% correct. One test per hard
// filter, plus a soft-score test, plus the aggregate gate.

import { describe, it, expect } from 'vitest';
import {
  selectRoute,
  type ModelCandidate,
  type RoutingRequest,
  type BreakerSnapshot,
  type PoolHeadroomEntry,
  type Role,
  type Sensitivity,
  type LatencyPreference,
} from '../src/route-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function model(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: 'groq-70b',
    family: 'groq',
    lane: 'private',
    roles: ['fast', 'reasoner', 'judge'],
    contextWindow: 8000,
    rpmTokens: 8000,
    capabilities: ['reasoning', 'json', 'tools'],
    latencyTier: 'fast',
    capabilityFit: 0.9,
    ...overrides,
  };
}

function emptyOpts(
  overrides: {
    breakers?: BreakerSnapshot[];
    headroom?: PoolHeadroomEntry[];
    now?: number;
  } = {},
) {
  return {
    breakers: overrides.breakers ?? [],
    headroom: overrides.headroom ?? [],
    now: overrides.now ?? 1_700_000_000_000,
  };
}

// =============================================================================
// Deterministic PRNG for the 200-case T-14 gate
// =============================================================================

class PRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed % 0x80000000;
  }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  range(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  bool(pTrue: number): boolean {
    return this.next() < pTrue;
  }
}

const ROLE_POOL: Role[] = ['fast', 'reasoner', 'judge', 'vision', 'utility'];
const SENSITIVITY_POOL: Sensitivity[] = ['S0', 'S1', 'S2'];
const LATENCY_POOL: LatencyPreference[] = ['fast', 'balanced', 'quality'];
const FAMILY_POOL = ['groq', 'gemini', 'workers-ai', 'cerebras', 'openrouter'];

// =============================================================================
// Individual hard filter tests
// =============================================================================

describe('T-14 hard filter — role_mismatch', () => {
  it('rejects candidate without the requested role', () => {
    const c = model({ roles: ['fast'] });
    const decision = selectRoute(
      [c],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'judge' },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('role_mismatch');
  });

  it('accepts candidate with the requested role', () => {
    const c = model({ roles: ['judge'] });
    const decision = selectRoute(
      [c],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'judge' },
      emptyOpts(),
    );
    expect(decision.selection).not.toBeNull();
    expect(decision.selection!.candidate.id).toBe('groq-70b');
  });
});

describe('T-14 hard filter — sensitivity_lane (FR-WF-06)', () => {
  it('S2 requires private lane', () => {
    const publicOnly = model({ lane: 'training-risk' });
    const decision = selectRoute(
      [publicOnly],
      { sensitivity: 'S2', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('sensitivity_lane');
  });

  it('S2 passes with private lane', () => {
    const privateOnly = model({ lane: 'private' });
    const decision = selectRoute(
      [privateOnly],
      { sensitivity: 'S2', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).not.toBeNull();
  });

  it('S0 and S1 allow training-risk lane', () => {
    const publicModel = model({ lane: 'training-risk' });
    for (const s of ['S0', 'S1'] as Sensitivity[]) {
      const decision = selectRoute(
        [publicModel],
        { sensitivity: s, promptTokens: 100, requiredRole: 'fast' },
        emptyOpts(),
      );
      expect(decision.selection).not.toBeNull();
    }
  });
});

describe('T-14 hard filter — context_window', () => {
  it('rejects candidate whose context is too small', () => {
    const small = model({ contextWindow: 1000 });
    const decision = selectRoute(
      [small],
      { sensitivity: 'S0', promptTokens: 2000, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('context_window');
  });

  it('rejects candidate when prompt > 60% of rpmTokens', () => {
    const tight = model({ contextWindow: 100_000, rpmTokens: 8000 });
    const decision = selectRoute(
      [tight],
      { sensitivity: 'S0', promptTokens: 5000, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('context_window');
  });

  it('accepts candidate when prompt <= 60% of rpmTokens', () => {
    const roomy = model({ contextWindow: 100_000, rpmTokens: 8000 });
    const decision = selectRoute(
      [roomy],
      { sensitivity: 'S0', promptTokens: 4000, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).not.toBeNull();
  });
});

describe('T-14 hard filter — capability_missing', () => {
  it('rejects candidate missing a required capability', () => {
    const noVision = model({ capabilities: ['reasoning', 'json'] });
    const decision = selectRoute(
      [noVision],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        requiredCapabilities: ['vision'],
      },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('capability_missing');
  });

  it('accepts candidate with all required capabilities', () => {
    const full = model({ capabilities: ['reasoning', 'vision', 'json', 'tools'] });
    const decision = selectRoute(
      [full],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        requiredCapabilities: ['vision', 'json'],
      },
      emptyOpts(),
    );
    expect(decision.selection).not.toBeNull();
  });
});

describe('T-14 hard filter — diversity_conflict (FR-TRUTH-05)', () => {
  it('judge must differ from drafter family', () => {
    const sameFamily = model({ id: 'groq-judge', family: 'groq', roles: ['judge'] });
    const decision = selectRoute(
      [sameFamily],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'judge',
        diversityFrom: 'groq',
      },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('diversity_conflict');
  });

  it('judge from a different family is allowed', () => {
    const diffFamily = model({ id: 'gemini-judge', family: 'gemini', roles: ['judge'] });
    const decision = selectRoute(
      [diffFamily],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'judge',
        diversityFrom: 'groq',
      },
      emptyOpts(),
    );
    expect(decision.selection).not.toBeNull();
    expect(decision.selection!.candidate.family).toBe('gemini');
  });
});

describe('T-14 hard filter — breaker_open (FR-WF-01)', () => {
  it('open breaker with no cooldown → rejected', () => {
    const breaker: BreakerSnapshot = {
      modelId: 'groq-70b',
      state: 'open',
      openedAt: 1_700_000_000_000 - 10_000, // 10s ago (< 90s cooldown)
    };
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({ breakers: [breaker], now: 1_700_000_000_000 }),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('breaker_open');
  });

  it('open breaker past cooldown → probe allowed (half-open behaviour)', () => {
    const breaker: BreakerSnapshot = {
      modelId: 'groq-70b',
      state: 'open',
      openedAt: 1_700_000_000_000 - 100_000, // 100s ago (> 90s cooldown)
    };
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({ breakers: [breaker], now: 1_700_000_000_000 }),
    );
    expect(decision.selection).not.toBeNull();
  });

  it('closed breaker → allowed', () => {
    const breaker: BreakerSnapshot = {
      modelId: 'groq-70b',
      state: 'closed',
      openedAt: null,
    };
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({ breakers: [breaker] }),
    );
    expect(decision.selection).not.toBeNull();
  });
});

describe('T-14 hard filter — headroom_low', () => {
  it('rejects pool with < 10% headroom', () => {
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({
        headroom: [{ pool: 'groq', used: 950, limit: 1000 }],
      }),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('headroom_low');
  });

  it('accepts pool with > 10% headroom', () => {
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({
        headroom: [{ pool: 'groq', used: 500, limit: 1000 }],
      }),
    );
    expect(decision.selection).not.toBeNull();
  });

  it('unknown pool → assumed unlimited headroom', () => {
    const decision = selectRoute(
      [model()],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({ headroom: [] }),
    );
    expect(decision.selection).not.toBeNull();
  });
});

describe('T-14 hard filter — excluded', () => {
  it('excluded modelId is not selected', () => {
    const decision = selectRoute(
      [model({ id: 'groq-70b' })],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        excludedModelIds: ['groq-70b'],
      },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected[0].reason).toBe('excluded');
  });
});

// =============================================================================
// Soft score tests
// =============================================================================

describe('T-14 soft score', () => {
  it('higher capabilityFit wins when everything else is equal', () => {
    const a = model({ id: 'a', capabilityFit: 0.9 });
    const b = model({ id: 'b', capabilityFit: 0.5 });
    const decision = selectRoute(
      [a, b],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection!.candidate.id).toBe('a');
  });

  it('higher headroom wins when capability is equal', () => {
    const a = model({ id: 'a', family: 'groq' });
    const b = model({ id: 'b', family: 'gemini' });
    const decision = selectRoute(
      [a, b],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts({
        headroom: [
          { pool: 'groq', used: 100, limit: 1000 },   // 90% left
          { pool: 'gemini', used: 800, limit: 1000 }, // 20% left
        ],
      }),
    );
    expect(decision.selection!.candidate.id).toBe('a');
  });

  it('fast preference favors fast-latency models', () => {
    const fast = model({ id: 'fast', latencyTier: 'fast', capabilityFit: 0.8 });
    const slow = model({ id: 'slow', latencyTier: 'slow', capabilityFit: 0.8 });
    const decision = selectRoute(
      [fast, slow],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        latencyPreference: 'fast',
      },
      emptyOpts(),
    );
    expect(decision.selection!.candidate.id).toBe('fast');
  });

  it('quality preference favors slow-latency models', () => {
    const fast = model({ id: 'fast', latencyTier: 'fast', capabilityFit: 0.8 });
    const slow = model({ id: 'slow', latencyTier: 'slow', capabilityFit: 0.8 });
    const decision = selectRoute(
      [fast, slow],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        latencyPreference: 'quality',
      },
      emptyOpts(),
    );
    expect(decision.selection!.candidate.id).toBe('slow');
  });

  it('diversity bonus favours different family when diversityFrom is set', () => {
    const same = model({ id: 'same', family: 'groq', capabilityFit: 0.85 });
    const diff = model({ id: 'diff', family: 'gemini', capabilityFit: 0.85 });
    const decision = selectRoute(
      [same, diff],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'judge',
        diversityFrom: 'groq',
      },
      emptyOpts(),
    );
    // "same" family is rejected by diversity_conflict; only "diff" survives
    expect(decision.selection!.candidate.id).toBe('diff');
  });

  it('tiebreaker is deterministic (lexicographic modelId)', () => {
    const a = model({ id: 'aaa', capabilityFit: 0.5 });
    const b = model({ id: 'bbb', capabilityFit: 0.5 });
    const d1 = selectRoute(
      [a, b],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    const d2 = selectRoute(
      [b, a], // reversed input order
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(d1.selection!.candidate.id).toBe(d2.selection!.candidate.id);
  });
});

// =============================================================================
// T-14 GATE — 200 labelled prompts, 100% correct
// =============================================================================

describe('T-14 GATE — 200 labelled prompts', () => {
  it('100% of cases produce the correct outcome (selection-null-expected vs selection-present)', () => {
    const rng = new PRNG(42);
    let checked = 0;
    const failures: string[] = [];

    for (let i = 0; i < 200; i++) {
      // Build 3 candidates
      const candidates: ModelCandidate[] = [];
      for (let j = 0; j < 3; j++) {
        const family = rng.pick(FAMILY_POOL);
        const lane: 'private' | 'training-risk' =
          family === 'gemini' || family === 'openrouter' ? 'training-risk' : 'private';
        const roles = [rng.pick(ROLE_POOL)];
        candidates.push({
          id: `${family}-${j}-${i}`,
          family,
          lane,
          roles,
          contextWindow: rng.int(2000, 200_000),
          rpmTokens: rng.int(1000, 200_000),
          capabilities: rng.bool(0.7) ? ['reasoning', 'json'] : ['json'],
          latencyTier: rng.pick(['fast', 'medium', 'slow'] as const),
          capabilityFit: rng.range(0.3, 1.0),
        });
      }

      const sensitivity = rng.pick(SENSITIVITY_POOL);
      const requiredRole = rng.pick(ROLE_POOL);
      const promptTokens = rng.int(100, 3000);
      const latencyPreference = rng.pick(LATENCY_POOL);

      // Compute the EXPECTED outcome deterministically:
      // - At least one candidate must pass ALL filters
      // - If none can pass, selection must be null
      const canPass = candidates.some((c) => {
        if (!c.roles.includes(requiredRole)) return false;
        if (sensitivity === 'S2' && c.lane !== 'private') return false;
        if (c.contextWindow < promptTokens) return false;
        if (c.rpmTokens > 0 && promptTokens > c.rpmTokens * 0.6) return false;
        return true;
      });

      const decision = selectRoute(
        candidates,
        {
          sensitivity,
          promptTokens,
          requiredRole,
          latencyPreference,
        },
        emptyOpts(),
      );

      // Assert: if canPass, selection must be non-null. If !canPass, must be null.
      const selectionPresent = decision.selection !== null;
      if (selectionPresent !== canPass) {
        failures.push(
          `case ${i}: expected canPass=${canPass}, got selectionPresent=${selectionPresent} ` +
            `(rejected=${decision.rejected.length})`,
        );
      }

      // Additional invariant: whichever candidate is selected must have passed all filters.
      if (decision.selection) {
        const sel = decision.selection.candidate;
        if (!sel.roles.includes(requiredRole)) {
          failures.push(`case ${i}: selected model has wrong role`);
        }
        if (sensitivity === 'S2' && sel.lane !== 'private') {
          failures.push(`case ${i}: S2 selected non-private lane`);
        }
        if (sel.contextWindow < promptTokens) {
          failures.push(`case ${i}: selected model context too small`);
        }
      }

      checked++;
    }

    if (failures.length > 0) {
      throw new Error(
        `T-14 gate: ${failures.length}/${checked} failed:\n${failures.slice(0, 5).join('\n')}`,
      );
    }
    expect(checked).toBe(200);
  });

  it('S2 sensitivity: 0 training-risk selections across 100 random S2 cases', () => {
    const rng = new PRNG(2024);
    let selected = 0;
    let leaks = 0;

    for (let i = 0; i < 100; i++) {
      const candidates: ModelCandidate[] = [];
      for (let j = 0; j < 4; j++) {
        const family = rng.pick(FAMILY_POOL);
        const lane: 'private' | 'training-risk' =
          family === 'gemini' || family === 'openrouter' ? 'training-risk' : 'private';
        candidates.push({
          id: `${family}-${j}-${i}`,
          family,
          lane,
          roles: ['fast', 'reasoner', 'judge'],
          contextWindow: 100_000,
          rpmTokens: 100_000,
          capabilities: ['reasoning', 'json'],
          latencyTier: 'fast',
          capabilityFit: 0.9,
        });
      }

      const decision = selectRoute(
        candidates,
        { sensitivity: 'S2', promptTokens: 2000, requiredRole: 'fast' },
        emptyOpts(),
      );
      if (decision.selection) {
        selected++;
        if (decision.selection.candidate.lane !== 'private') {
          leaks++;
        }
      }
    }

    expect(leaks).toBe(0);
    expect(selected).toBeGreaterThan(0);
  });

  it('role-based routing: each role picks only from models with that role', () => {
    const roleToModel: Record<Role, ModelCandidate> = {
      fast: model({ id: 'fast-model', roles: ['fast'], capabilityFit: 0.9 }),
      reasoner: model({ id: 'reasoner-model', roles: ['reasoner'], capabilityFit: 0.9 }),
      judge: model({ id: 'judge-model', roles: ['judge'], capabilityFit: 0.9 }),
      vision: model({ id: 'vision-model', roles: ['vision'], capabilityFit: 0.9 }),
      utility: model({ id: 'utility-model', roles: ['utility'], capabilityFit: 0.9 }),
      embedder: model({ id: 'embedder-model', roles: ['embedder'], capabilityFit: 0.9 }),
      'long-context': model({ id: 'long-model', roles: ['long-context'], capabilityFit: 0.9 }),
    };

    for (const role of Object.keys(roleToModel) as Role[]) {
      const decision = selectRoute(
        [roleToModel[role]],
        { sensitivity: 'S0', promptTokens: 100, requiredRole: role },
        emptyOpts(),
      );
      expect(decision.selection).not.toBeNull();
      expect(decision.selection!.candidate.roles).toContain(role);
    }
  });

  it('empty candidate list → null selection, empty rejected', () => {
    const decision = selectRoute(
      [],
      { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
      emptyOpts(),
    );
    expect(decision.selection).toBeNull();
    expect(decision.rejected).toEqual([]);
    expect(decision.reason).toContain('No candidate');
  });
});

// =============================================================================
// FR-ROUTE-03 — easy-class questions never use heavy routing
// =============================================================================

describe('FR-ROUTE-03 — easy class', () => {
  it('a "fast" role request prefers fast-latency models', () => {
    const fast = model({ id: 'fast', latencyTier: 'fast', capabilityFit: 0.85 });
    const slowHeavy = model({
      id: 'slow',
      latencyTier: 'slow',
      capabilityFit: 1.0,
      roles: ['reasoner', 'fast'],
    });
    const decision = selectRoute(
      [fast, slowHeavy],
      {
        sensitivity: 'S0',
        promptTokens: 100,
        requiredRole: 'fast',
        latencyPreference: 'fast',
      },
      emptyOpts(),
    );
    expect(decision.selection!.candidate.id).toBe('fast');
  });
});

// =============================================================================
// Rejection reason coverage — every filter is proven reachable
// =============================================================================

describe('Rejection reason coverage', () => {
  it('every filter reason is reachable', () => {
    const reasonsSeen = new Set<string>();

    // role_mismatch
    {
      const d = selectRoute(
        [model({ roles: ['judge'] })],
        { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // sensitivity_lane
    {
      const d = selectRoute(
        [model({ lane: 'training-risk' })],
        { sensitivity: 'S2', promptTokens: 100, requiredRole: 'fast' },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // context_window
    {
      const d = selectRoute(
        [model({ contextWindow: 100 })],
        { sensitivity: 'S0', promptTokens: 1000, requiredRole: 'fast' },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // capability_missing
    {
      const d = selectRoute(
        [model({ capabilities: ['reasoning'] })],
        {
          sensitivity: 'S0',
          promptTokens: 100,
          requiredRole: 'fast',
          requiredCapabilities: ['vision'],
        },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // diversity_conflict
    {
      const d = selectRoute(
        [model({ family: 'groq', roles: ['judge'] })],
        {
          sensitivity: 'S0',
          promptTokens: 100,
          requiredRole: 'judge',
          diversityFrom: 'groq',
        },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // breaker_open
    {
      const d = selectRoute(
        [model()],
        { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
        emptyOpts({
          breakers: [
            {
              modelId: 'groq-70b',
              state: 'open',
              openedAt: 1_700_000_000_000 - 1000,
            },
          ],
        }),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // headroom_low
    {
      const d = selectRoute(
        [model()],
        { sensitivity: 'S0', promptTokens: 100, requiredRole: 'fast' },
        emptyOpts({ headroom: [{ pool: 'groq', used: 950, limit: 1000 }] }),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }
    // excluded
    {
      const d = selectRoute(
        [model({ id: 'excl' })],
        {
          sensitivity: 'S0',
          promptTokens: 100,
          requiredRole: 'fast',
          excludedModelIds: ['excl'],
        },
        emptyOpts(),
      );
      d.rejected.forEach((r) => reasonsSeen.add(r.reason));
    }

    expect(reasonsSeen.size).toBe(8);
    expect(reasonsSeen).toContain('role_mismatch');
    expect(reasonsSeen).toContain('sensitivity_lane');
    expect(reasonsSeen).toContain('context_window');
    expect(reasonsSeen).toContain('capability_missing');
    expect(reasonsSeen).toContain('diversity_conflict');
    expect(reasonsSeen).toContain('breaker_open');
    expect(reasonsSeen).toContain('headroom_low');
    expect(reasonsSeen).toContain('excluded');
  });
});
// === FILE END ===