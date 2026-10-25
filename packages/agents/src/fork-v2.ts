// === FILE START ===
// packages/agents/src/fork-v2.ts
// PRD §10.9 · FR-AGENT-06 · F-098 · T-13.
//
// Agent fork. Given a recorded trace and a fork point, produce two pieces of
// pure data:
//
//   · prefix        — the original events from seq 1 up to and including
//                     forkSeq. These are unchanged.
//   · forkedEvents  — the alternative events, with seq renumbered from
//                     forkSeq + 1 and monotonic timestamps derived from the
//                     fork point's timestamp.
//
// This is the W8 bridge for FR-AGENT-06 ("Change one decision and re-run to
// compare"). No execution. No side effects. The caller can hand `forkedEvents`
// back to `runEndToEnd` (or a real runner) to re-simulate the divergent path.
//
// Zero external imports (relative-only).

import type { TraceEvent } from './replay-v2.js';

export interface ForkAlternative {
  kind: string;
  description: string;
  /** Optional. If omitted, timestamp = fork-point ts + index + 1. */
  timestampMs?: number;
  data?: Record<string, unknown>;
}

export interface ForkResult {
  prefix: TraceEvent[];
  forkedEvents: TraceEvent[];
  summary: string;
}

const MS_PER_FORK_STEP = 1;

export function forkAt(
  trace: readonly TraceEvent[],
  forkSeq: number,
  alternatives: readonly ForkAlternative[],
): ForkResult {
  if (trace.length === 0) {
    throw new Error('forkAt: trace is empty');
  }

  const sorted = [...trace].sort((a, b) => a.seq - b.seq);
  const forkPoint = sorted.find((e) => e.seq === forkSeq);
  if (forkPoint === undefined) {
    throw new Error(`forkAt: forkSeq ${forkSeq} is not in the trace`);
  }

  for (let i = 0; i < alternatives.length; i++) {
    const a = alternatives[i]!;
    if (typeof a.kind !== 'string' || a.kind.length === 0) {
      throw new Error(`forkAt: alternatives[${i}].kind must be a non-empty string`);
    }
    if (typeof a.description !== 'string') {
      throw new Error(`forkAt: alternatives[${i}].description must be a string`);
    }
  }

  const prefix = sorted.filter((e) => e.seq <= forkSeq).map((e) => ({ ...e }));

  const forkedEvents: TraceEvent[] = alternatives.map((alt, index) => {
    const ts =
      alt.timestampMs !== undefined
        ? alt.timestampMs
        : forkPoint.timestampMs + (index + 1) * MS_PER_FORK_STEP;
    const out: TraceEvent = {
      seq: forkSeq + index + 1,
      timestampMs: ts,
      kind: alt.kind,
      description: alt.description,
    };
    if (alt.data !== undefined) out.data = alt.data;
    return out;
  });

  const altCount = alternatives.length;
  const summary =
    `Fork at seq ${forkSeq} ("${forkPoint.description}"). ` +
    `Prefix has ${prefix.length} event${prefix.length === 1 ? '' : 's'}; ` +
    `forked run adds ${altCount} event${altCount === 1 ? '' : 's'}.`;

  return { prefix, forkedEvents, summary };
}
// === FILE END ===