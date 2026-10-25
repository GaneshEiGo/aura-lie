// === FILE START ===
// packages/agents/src/compare-v2.ts
// PRD §10.9 · FR-AGENT-06 · F-098.
//
// Compare two end-to-end runs at the event, dry-run, and stop level. Returns
// a structured comparison plus a one-paragraph stranger-readable narrative.
//
// The event-level diff is delegated to `diffTraces` from replay-v2 so there
// is one source of truth for "what differs". This module adds:
//   · a dry-run comparison (same counts, same irreversible flag)
//   · a stop comparison (same stop reason, or which side stopped vs ran on)
//   · a narrative line that names the concrete deltas
//
// Pure. No execution. No side effects.

import type { TraceDiff, TraceEvent } from './replay-v2.js';
import { diffTraces } from './replay-v2.js';
import type { EndToEndRun, MissionEvent } from './mission-scenario-v2.js';
import type { StopReason } from './mission-runner-v2.js';

export interface RunComparison {
  same: boolean;
  eventDiff: TraceDiff;
  stopSame: boolean;
  stopA: StopReason | null;
  stopB: StopReason | null;
  dryRunSame: boolean;
  narrative: string;
}

function toTrace(events: readonly MissionEvent[]): TraceEvent[] {
  return events.map((e) => ({
    seq: e.seq,
    timestampMs: e.timestampMs,
    kind: e.kind,
    description: e.description,
  }));
}

export function compareRuns(a: EndToEndRun, b: EndToEndRun): RunComparison {
  const eventDiff = diffTraces(toTrace(a.events), toTrace(b.events));
  const stopSame = a.stopped === b.stopped;

  const dryRunSame =
    a.dryRun.readCount === b.dryRun.readCount &&
    a.dryRun.writeCount === b.dryRun.writeCount &&
    a.dryRun.searchCount === b.dryRun.searchCount &&
    a.dryRun.runCount === b.dryRun.runCount &&
    a.dryRun.irreversible === b.dryRun.irreversible;

  const same = eventDiff.same && stopSame && dryRunSame;

  const parts: string[] = [];

  if (same) {
    parts.push(
      `Run A and Run B are identical: ${a.events.length} events, ` +
        `stop reason ${a.stopped === null ? 'none' : `"${a.stopped}"`}.`,
    );
  } else {
    const addedInA = eventDiff.onlyInA.length;
    const addedInB = eventDiff.onlyInB.length;
    const common = eventDiff.commonCount;

    parts.push(
      `Run A: ${a.events.length} events, stop reason ` +
        `${a.stopped === null ? 'none' : `"${a.stopped}"`}.`,
    );
    parts.push(
      `Run B: ${b.events.length} events, stop reason ` +
        `${b.stopped === null ? 'none' : `"${b.stopped}"`}.`,
    );
    parts.push(
      `Shared: ${common} event${common === 1 ? '' : 's'}.`,
    );
    if (addedInA > 0 || addedInB > 0) {
      parts.push(
        `Differing: ${addedInA} event${addedInA === 1 ? '' : 's'} only in A; ` +
          `${addedInB} event${addedInB === 1 ? '' : 's'} only in B.`,
      );
    }
    if (!stopSame) {
      parts.push(
        `Stop reason differs: A is ` +
          `${a.stopped === null ? 'none' : `"${a.stopped}"`}, ` +
          `B is ${b.stopped === null ? 'none' : `"${b.stopped}"`}.`,
      );
    }
    if (!dryRunSame) {
      parts.push(
        `Dry-run plan differs: A planned ` +
          `${a.dryRun.readCount} read / ${a.dryRun.writeCount} write / ` +
          `${a.dryRun.searchCount} search / ${a.dryRun.runCount} run; ` +
          `B planned ` +
          `${b.dryRun.readCount} read / ${b.dryRun.writeCount} write / ` +
          `${b.dryRun.searchCount} search / ${b.dryRun.runCount} run.`,
      );
    }
  }

  return {
    same,
    eventDiff,
    stopSame,
    stopA: a.stopped,
    stopB: b.stopped,
    dryRunSame,
    narrative: parts.join(' '),
  };
}
// === FILE END ===