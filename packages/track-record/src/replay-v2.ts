// === FILE START ===
// packages/track-record/src/replay-v2.ts
// PRD §18.3 FR-TRACET-03 · §15.2 T-07 · Appendix C.
//
// Replay a past turn's events as a timeline. PURE FUNCTION — no provider
// call, no network, no device side-effect. The same event list always
// produces the same ReplayResult, character for character.
//
// Events mirror the ChatEvent union in PRD Appendix C, reduced to the fields
// replay actually consumes.

export type ReplayEvent =
  | {
      seq: number;
      t: 'meta';
      mode: 'instant' | 'think' | 'research' | 'council';
      persona: string;
      sensitivity: 'S0' | 'S1' | 'S2';
      riskTier: 0 | 1 | 2 | 3;
    }
  | { seq: number; t: 'token'; delta: string }
  | {
      seq: number;
      t: 'claim';
      id: string;
      text: string;
      claimType: string;
      importance: number;
    }
  | { seq: number; t: 'source'; id: string; title: string; domain: string; tier: number }
  | { seq: number; t: 'score'; claimId: string; score: number | null; status: string }
  | {
      seq: number;
      t: 'summary';
      overall: number | null;
      checked: number;
      checkable: number;
      chip: string;
    }
  | { seq: number; t: 'done'; elapsedMs: number; calls: number; tokens: number; costInr: 0 };

export interface ReplayedClaim {
  id: string;
  text: string;
  claimType: string;
  importance: number;
  score: number | null;
  status: string | null;
}

export interface ReplayedSource {
  id: string;
  title: string;
  domain: string;
  tier: number;
}

export interface ReplayMeta {
  mode: 'instant' | 'think' | 'research' | 'council';
  persona: string;
  sensitivity: 'S0' | 'S1' | 'S2';
  riskTier: 0 | 1 | 2 | 3;
}

export interface ReplaySummary {
  overall: number | null;
  checked: number;
  checkable: number;
  chip: string;
}

export interface ReplayDone {
  elapsedMs: number;
  calls: number;
  tokens: number;
  costInr: 0;
}

export interface ReplayResult {
  answer: string;
  claims: ReplayedClaim[];
  sources: ReplayedSource[];
  summary: ReplaySummary | null;
  meta: ReplayMeta | null;
  done: ReplayDone | null;
  event_count: number;
}

/**
 * Replay a turn from its stored events. PURE: only takes events as input;
 * returns the same result on every call; does not mutate the input array or
 * any of its elements.
 */
export function replayTurn(events: ReplayEvent[]): ReplayResult {
  let answer = '';
  let meta: ReplayMeta | null = null;
  let summary: ReplaySummary | null = null;
  let done: ReplayDone | null = null;

  const claimMap = new Map<string, ReplayedClaim>();
  const sourceMap = new Map<string, ReplayedSource>();
  const scoreMap = new Map<string, { score: number | null; status: string }>();

  for (const ev of events) {
    switch (ev.t) {
      case 'meta':
        meta = {
          mode: ev.mode,
          persona: ev.persona,
          sensitivity: ev.sensitivity,
          riskTier: ev.riskTier,
        };
        break;
      case 'token':
        answer += ev.delta;
        break;
      case 'claim':
        claimMap.set(ev.id, {
          id: ev.id,
          text: ev.text,
          claimType: ev.claimType,
          importance: ev.importance,
          score: null,
          status: null,
        });
        break;
      case 'source':
        sourceMap.set(ev.id, {
          id: ev.id,
          title: ev.title,
          domain: ev.domain,
          tier: ev.tier,
        });
        break;
      case 'score':
        scoreMap.set(ev.claimId, { score: ev.score, status: ev.status });
        break;
      case 'summary':
        summary = {
          overall: ev.overall,
          checked: ev.checked,
          checkable: ev.checkable,
          chip: ev.chip,
        };
        break;
      case 'done':
        done = {
          elapsedMs: ev.elapsedMs,
          calls: ev.calls,
          tokens: ev.tokens,
          costInr: ev.costInr,
        };
        break;
    }
  }

  const claims: ReplayedClaim[] = [];
  for (const c of claimMap.values()) {
    const s = scoreMap.get(c.id);
    claims.push({
      ...c,
      score: s ? s.score : null,
      status: s ? s.status : null,
    });
  }

  return {
    answer,
    claims,
    sources: Array.from(sourceMap.values()),
    summary,
    meta,
    done,
    event_count: events.length,
  };
}

/**
 * Serialise for determinism checks. JSON.stringify with sorted keys so two
 * replays that produce structurally-equal results compare equal.
 */
export function replaySignature(r: ReplayResult): string {
  return JSON.stringify({
    answer: r.answer,
    claims: r.claims,
    sources: r.sources,
    summary: r.summary,
    meta: r.meta,
    done: r.done,
    event_count: r.event_count,
  });
}
// === FILE END ===