// === FILE START ===
// packages/agents/src/replay-v2.ts
// PRD §10.9 · F-098 · T-13.
//
// Replay a recorded mission trace. Data only. No re-execution. No side
// effects. This is the pre-W8 bridge for capability scenario 5
// ("a stranger can follow the run from its trace alone").
//
// Three operations:
//
//   · validateTrace(events)  — structural check. Seq strictly increasing,
//                              timestamps non-decreasing, every event has a
//                              non-empty kind and a string description.
//   · replayTrace(events)    — sorted, summarised, stranger-readable.
//   · diffTraces(a, b)       — what changed between two runs at event level.
//                              The eventual W8 fork tool will call this.
//
// Zero external imports.

export interface TraceEvent {
  seq: number;
  timestampMs: number;
  kind: string;
  description: string;
  data?: Record<string, unknown>;
}

export interface TraceValidation {
  ok: boolean;
  errors: string[];
}

export function validateTrace(events: readonly TraceEvent[]): TraceValidation {
  const errors: string[] = [];

  if (events.length === 0) {
    return { ok: true, errors: [] };
  }

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const cur = events[i]!;
    if (cur.seq <= prev.seq) {
      errors.push(
        `seq not strictly increasing at index ${i}: ${prev.seq} → ${cur.seq}`,
      );
    }
    if (cur.timestampMs < prev.timestampMs) {
      errors.push(
        `timestamp went backwards at index ${i}: ${prev.timestampMs} → ${cur.timestampMs}`,
      );
    }
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (typeof e.kind !== 'string' || e.kind.length === 0) {
      errors.push(`event ${i} has empty kind`);
    }
    if (typeof e.description !== 'string') {
      errors.push(`event ${i} has non-string description`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export interface ReplaySummary {
  events: TraceEvent[];
  eventCount: number;
  totalElapsedMs: number;
  kinds: Record<string, number>;
  firstDescription: string;
  lastDescription: string;
  summary: string;
}

export function replayTrace(events: readonly TraceEvent[]): ReplaySummary {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const kinds: Record<string, number> = {};
  for (const e of sorted) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  }

  const firstTs = sorted.length > 0 ? sorted[0]!.timestampMs : 0;
  const lastTs =
    sorted.length > 0 ? sorted[sorted.length - 1]!.timestampMs : 0;
  const totalElapsedMs = lastTs - firstTs;

  const firstDescription = sorted.length > 0 ? sorted[0]!.description : '';
  const lastDescription =
    sorted.length > 0 ? sorted[sorted.length - 1]!.description : '';

  const kindKeys = Object.keys(kinds).sort();
  const kindPart =
    kindKeys.length === 0
      ? ''
      : kindKeys.map((k) => `${k}×${kinds[k]}`).join(', ');

  const parts: string[] = [];
  parts.push(`${sorted.length} event${sorted.length === 1 ? '' : 's'}`);
  if (totalElapsedMs > 0) parts.push(`${totalElapsedMs} ms elapsed`);
  if (kindPart.length > 0) parts.push(kindPart);
  if (firstDescription.length > 0) {
    parts.push(`first: "${firstDescription}"`);
    parts.push(`last: "${lastDescription}"`);
  }

  return {
    events: sorted,
    eventCount: sorted.length,
    totalElapsedMs,
    kinds,
    firstDescription,
    lastDescription,
    summary: parts.join(' · '),
  };
}

export interface TraceDiff {
  same: boolean;
  onlyInA: TraceEvent[];
  onlyInB: TraceEvent[];
  commonCount: number;
}

export function diffTraces(
  a: readonly TraceEvent[],
  b: readonly TraceEvent[],
): TraceDiff {
  const mapA = new Map<number, TraceEvent>();
  const mapB = new Map<number, TraceEvent>();
  for (const e of a) mapA.set(e.seq, e);
  for (const e of b) mapB.set(e.seq, e);

  const onlyInA: TraceEvent[] = [];
  const onlyInB: TraceEvent[] = [];
  let commonCount = 0;

  for (const [seq, ea] of mapA) {
    const eb = mapB.get(seq);
    if (eb === undefined) {
      onlyInA.push(ea);
    } else if (
      eb.kind === ea.kind &&
      eb.description === ea.description
    ) {
      commonCount++;
    } else {
      onlyInA.push(ea);
      onlyInB.push(eb);
    }
  }
  for (const [seq, eb] of mapB) {
    if (!mapA.has(seq)) onlyInB.push(eb);
  }

  onlyInA.sort((x, y) => x.seq - y.seq);
  onlyInB.sort((x, y) => x.seq - y.seq);

  return {
    same: onlyInA.length === 0 && onlyInB.length === 0,
    onlyInA,
    onlyInB,
    commonCount,
  };
}
// === FILE END ===