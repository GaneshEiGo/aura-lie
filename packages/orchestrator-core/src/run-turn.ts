// packages/orchestrator-core/src/run-turn.ts
// PRD 7.1 the Aura-lie loop, PRD 7.2 request lifecycle, Appendix C event order.

import {
  extractFeatures,
  route,
} from '@aura-lie/router-engine';
import type {
  Candidate,
  Features,
  ModelRole,
  RoutingResult,
} from '@aura-lie/router-engine';
import { runWaterfall } from '@aura-lie/circuit-breaker';
import { streamThrough } from '@aura-lie/stream-proxy';
import type {
  ChatEvent,
  ProxyResult,
} from '@aura-lie/stream-proxy';
import { summarizeResponse } from '@aura-lie/truth';
import type {
  TurnDeps,
  TurnMode,
  TurnRequest,
  TurnResult,
  VerificationResult,
} from './types.js';
import { CLAIMS_PER_TIER } from './types.js';

const MODE_TO_ROLE: Record<Exclude<TurnMode, 'council'>, ModelRole> = {
  instant: 'chat_fast',
  think: 'reasoner',
  research: 'reasoner',
};

function modeForLoop(loop: 'light' | 'standard' | 'deep'): TurnMode {
  if (loop === 'light') return 'instant';
  if (loop === 'standard') return 'think';
  return 'research';
}

type SummaryChip =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'MIXED'
  | 'WEAK'
  | 'CHECK'
  | 'PARTIAL'
  | 'RECALL-ONLY';

export async function runTurn(
  req: TurnRequest,
  deps: TurnDeps,
): Promise<TurnResult> {
  const clock = deps.clock ?? { now: () => Date.now() };
  const start = clock.now();
  const events: ChatEvent[] = [];
  let traceSeq = 0;

  const pushTrace = (type: string, text: string, data?: unknown): void => {
    events.push({
      t: 'trace',
      seq: traceSeq++,
      tMs: clock.now() - start,
      type,
      text,
      data,
    });
  };

  const pushError = (code: string, userMessage: string, retryHint?: string): void => {
    events.push({ t: 'error', code, userMessage, retryHint });
  };

  const pushDone = (tokens: number, calls: number): void => {
    events.push({
      t: 'done',
      elapsedMs: clock.now() - start,
      calls,
      tokens,
      costInr: 0,
    });
  };

  const bytesOf = (evs: ChatEvent[]): number =>
    evs.reduce((sum, e) => sum + JSON.stringify(e).length, 0);

  const finalize = (
    features: Features,
    candidates: Candidate[],
    role: ModelRole,
    winner?: Candidate,
    verification?: VerificationResult,
    routing?: RoutingResult,
  ): TurnResult => ({
    turnId: req.turnId,
    events,
    features,
    candidates,
    winner,
    verification,
    durationMs: clock.now() - start,
    bytesOut: bytesOf(events),
    routing,
    role,
  });

  // === 1. Perceive ========================================================
  let features: Features;
  try {
    features = extractFeatures(req.text);
  } catch {
    features = {
      intent: 'chat',
      riskTier: 0,
      needsFreshInfo: false,
      tools: [],
      loop: 'light',
      sensitivityHint: 'S0',
      language: 'en',
      confidence: 0.5,
    };
  }

  const persona = req.persona ?? 'Aura-lie';
  const mode: TurnMode = req.mode ?? modeForLoop(features.loop);
  const sensitivity = req.sensitivity ?? features.sensitivityHint;
  const riskTier = req.riskTier ?? features.riskTier;

  if (mode === 'council') {
    events.push({
      t: 'meta',
      v: 1,
      turnId: req.turnId,
      mode,
      persona,
      route: { role: 'chat_quality', family: 'groq' },
      sensitivity,
      riskTier,
    });
    pushError(
      'council-not-supported',
      'Council mode is orchestrated by the council-engine, not runTurn.',
      'Use the Council flow or another mode.',
    );
    pushDone(0, 0);
    return finalize(features, [], 'chat_quality');
  }

  const role = MODE_TO_ROLE[mode];

  // === 2. Plan ============================================================
  let routing: RoutingResult;
  try {
    routing = route(req.text, role, {
      registry: deps.registry,
      breakers: deps.breakers,
      headroom: deps.headroom,
    });
  } catch (err) {
    events.push({
      t: 'meta',
      v: 1,
      turnId: req.turnId,
      mode,
      persona,
      route: { role, family: 'groq' },
      sensitivity,
      riskTier,
    });
    pushError(
      'routing-failed',
      err instanceof Error ? err.message : 'Routing failed.',
    );
    pushDone(0, 0);
    return finalize(features, [], role);
  }

  const metaRouteFamily: Candidate['family'] =
    routing.candidates[0]?.family ?? 'groq';
  events.push({
    t: 'meta',
    v: 1,
    turnId: req.turnId,
    mode,
    persona,
    route: { role, family: metaRouteFamily },
    sensitivity,
    riskTier,
  });

  pushTrace(
    'plan',
    `intent=${features.intent} loop=${features.loop} riskTier=${riskTier}`,
    features,
  );

  if (routing.candidates.length === 0) {
    const reasons = routing.scored
      .filter((s) => s.rejected)
      .map((s) => `${s.candidate.family}: ${s.rejected!.filter}`)
      .join('; ');
    pushError(
      'no-candidates',
      'No model available for this request.',
      reasons || 'Try a shorter prompt or a different mode.',
    );
    pushDone(0, 0);
    return finalize(features, [], role, undefined, undefined, routing);
  }

  pushTrace(
    'route',
    `candidates=${routing.candidates.map((c) => c.family).join(',')}`,
  );

  // === 3+4+5. Recall → Route → Generate ==================================
  type AttemptResult = { candidate: Candidate; proxyResult: ProxyResult };

  const waterfallResult = await runWaterfall(
    routing.candidates,
    async (candidate: Candidate): Promise<AttemptResult> => {
      const adapter = deps.adapters[candidate.family];
      if (!adapter) {
        throw new Error(`no adapter registered for ${candidate.family}`);
      }

      let reservationTokenId: string | null = null;
      if (deps.ledger) {
        const r = deps.ledger.reserve(
          candidate.family,
          routing.promptTokens,
          'interactive',
        );
        if (!r.ok && r.reason !== 'unknown-pool') {
          throw new Error(`quota: ${r.reason ?? 'denied'}`);
        }
        reservationTokenId = r.ok ? (r.token?.id ?? null) : null;
      }

      const chatReq = {
        turnId: req.turnId,
        model: candidate.model,
        messages: [{ role: 'user' as const, content: req.text }],
        mode,
        sensitivity,
      };

      const proxyResult = await streamThrough(adapter, chatReq, {
        clock: deps.clock,
        maxSubrequests: req.maxSubrequests,
        meta: {
          persona,
          route: { role: candidate.role, family: candidate.family },
          riskTier,
          mode,
        },
      });

      if (deps.ledger && reservationTokenId) {
        const actual = proxyResult.promptTokens + proxyResult.completionTokens;
        deps.ledger.commit(reservationTokenId, actual);
      }

      if (proxyResult.errored) {
        const errEv = proxyResult.events.find((e) => e.t === 'error');
        throw new Error(
          errEv && errEv.t === 'error' ? errEv.userMessage : 'adapter errored',
        );
      }

      return { candidate, proxyResult };
    },
    { breakers: deps.breakers, clock: deps.clock },
  );

  if (!waterfallResult.ok) {
    const reasons = waterfallResult.attempts
      .map((a) => `${a.candidate.family}: ${a.reason ?? a.outcome}`)
      .join('; ');
    pushError(
      'all-providers-failed',
      'Every model failed to respond. Try again.',
      reasons || 'Retry in a few seconds.',
    );
    pushDone(0, 0);
    return finalize(
      features,
      routing.candidates,
      role,
      undefined,
      undefined,
      routing,
    );
  }

  const { candidate: winner, proxyResult } =
    waterfallResult.value as AttemptResult;

  pushTrace(
    'generate',
    `winner=${winner.family} subrequests=${proxyResult.subrequestsUsed}`,
  );

  // Splice inner events (skip inner meta and inner done) AND accumulate
  // answer text so verification runs on the ANSWER, not the question.
  let answerText = '';
  for (let i = 1; i < proxyResult.events.length - 1; i++) {
    const ev = proxyResult.events[i];
    events.push(ev);
    if (ev.t === 'token') {
      answerText += ev.delta;
    }
  }

  // === 6. Verify (post-stream, on the ANSWER text) =======================
  let verification: VerificationResult | undefined;
  const maxClaims = CLAIMS_PER_TIER[riskTier as 0 | 1 | 2 | 3] ?? 0;

  if (deps.verify && maxClaims > 0 && answerText.length > 0) {
    try {
      verification = await deps.verify({
        text: answerText,
        features,
        maxClaims,
      });
      pushTrace(
        'verify',
        `checked=${verification.checked}/${verification.checkable}`,
      );

      for (const claim of verification.claims) {
        events.push({
          t: 'claim',
          id: claim.id,
          text: claim.text,
          claimType: claim.type,
          importance:
            typeof claim.importance === 'number'
              ? claim.importance
              : claim.importance === 'central'
                ? 1.0
                : 0.5,
        });

        for (const src of claim.sources) {
          events.push({
            t: 'source',
            id: src.id,
            title: src.title,
            domain: src.domain,
            tier: src.tier,
            published: src.published,
            independenceGroup: src.independenceGroup,
          });
          events.push({
            t: 'quote',
            sourceId: src.id,
            claimId: claim.id,
            text: src.quote,
            matchOk: src.matchOk,
          });
        }

        events.push({
          t: 'score',
          claimId: claim.id,
          score: claim.score,
          status: claim.status,
          factors: claim.factors,
          caps: claim.capsApplied,
          penalties: 0,
        });
      }

      const summary = summarizeResponse(
        verification.claims,
        verification.checkable,
      );
      events.push({
        t: 'summary',
        overall: summary.overall,
        checked: summary.checked,
        checkable: verification.checkable,
        chip: summary.chip as SummaryChip,
        heuristic: true,
      });
    } catch (err) {
      pushTrace(
        'verify-error',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // === 7. Done (always last) =============================================
  pushDone(proxyResult.promptTokens + proxyResult.completionTokens, 1);

  // === 8. Learn (fire-and-forget) ========================================
  if (deps.curate) {
    try {
      const p = deps.curate(req, verification);
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          /* never surface curation failures to the caller */
        });
      }
    } catch {
      /* never surface curation failures to the caller */
    }
  }

  return finalize(
    features,
    routing.candidates,
    role,
    winner,
    verification,
    routing,
  );
}