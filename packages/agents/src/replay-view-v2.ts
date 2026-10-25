// === FILE START ===
// packages/agents/src/replay-view-v2.ts
// PRD §10.9 · §15.5 · F-098 · FR-AGENT-06.
//
// W8 interactive replay — the UI render contract. Takes the recorded trace
// (from replay-v2) and produces one row view per event, each carrying:
//
//   · displayKind       — human-readable label ("Plan", "Search", "Verified claim")
//   · iconKey           — a stable string the UI maps to a pixel glyph
//   · accessibleLabel   — screen-reader sentence: "<DisplayKind> (step N): <desc>"
//   · relativeTimestampMs — delta from the first event (0 for row 1)
//   · timestampLabel    — pre-formatted "t+0ms" or "t+1.2s"
//   · jumpAffordance    — { seq, label } so the UI can offer "Jump to step N"
//
// Rules the module enforces:
//   · Rows are sorted by seq, regardless of input order.
//   · Every known kind maps to its own displayKind and iconKey. Unknown kinds
//     fall back to iconKey "other" and a capitalised version of the raw kind.
//   · Empty trace → empty array (no throw).
//   · Pure: no side effects, no imports from outside packages/agents/src.
//
// This is the "stranger-readable" contract (PRD §15.5 capability 5): every row
// is a complete, self-contained sentence the UI can drop on screen without
// further transformation.

import type { TraceEvent } from './replay-v2.js';

export type IconKey =
  | 'plan'
  | 'search'
  | 'verify'
  | 'synthesise'
  | 'done'
  | 'error'
  | 'retry'
  | 'conflict'
  | 'resolve'
  | 'ask-user'
  | 'load-state'
  | 'resume'
  | 'execute'
  | 'dry-run'
  | 'step'
  | 'progress'
  | 'no-progress'
  | 'stop'
  | 'other';

export interface ReplayRowView {
  seq: number;
  displayKind: string;
  iconKey: IconKey;
  accessibleLabel: string;
  description: string;
  relativeTimestampMs: number;
  timestampLabel: string;
  jumpAffordance: { seq: number; label: string };
}

interface KindMapping {
  iconKey: IconKey;
  displayKind: string;
}

const KIND_TABLE: Readonly<Record<string, KindMapping>> = Object.freeze({
  plan: { iconKey: 'plan', displayKind: 'Plan' },
  search: { iconKey: 'search', displayKind: 'Search' },
  verify: { iconKey: 'verify', displayKind: 'Verified claim' },
  synthesise: { iconKey: 'synthesise', displayKind: 'Synthesised answer' },
  done: { iconKey: 'done', displayKind: 'Done' },
  error: { iconKey: 'error', displayKind: 'Error' },
  retry: { iconKey: 'retry', displayKind: 'Retry' },
  conflict: { iconKey: 'conflict', displayKind: 'Conflict' },
  resolve: { iconKey: 'resolve', displayKind: 'Resolved' },
  'ask-user': { iconKey: 'ask-user', displayKind: 'Asked user' },
  'load-state': { iconKey: 'load-state', displayKind: 'Loaded state' },
  resume: { iconKey: 'resume', displayKind: 'Resumed' },
  execute: { iconKey: 'execute', displayKind: 'Executed' },
  'dry-run': { iconKey: 'dry-run', displayKind: 'Dry-run plan' },
  step: { iconKey: 'step', displayKind: 'Step' },
  progress: { iconKey: 'progress', displayKind: 'Progress' },
  'no-progress': { iconKey: 'no-progress', displayKind: 'No progress' },
  stop: { iconKey: 'stop', displayKind: 'Stopped' },
});

function capitalise(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return 'Unknown';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mapKind(kind: string): KindMapping {
  const known = KIND_TABLE[kind];
  if (known !== undefined) return known;
  return { iconKey: 'other', displayKind: capitalise(kind) };
}

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 't+0ms';
  if (ms < 1000) return `t+${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `t+${seconds.toFixed(1)}s`;
}

export function buildReplayView(
  events: readonly TraceEvent[],
): ReplayRowView[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const originTs = sorted[0]!.timestampMs;

  return sorted.map((e) => {
    const mapping = mapKind(e.kind);
    const relative = e.timestampMs - originTs;
    return {
      seq: e.seq,
      displayKind: mapping.displayKind,
      iconKey: mapping.iconKey,
      accessibleLabel:
        `${mapping.displayKind} (step ${e.seq}): ${e.description}`,
      description: e.description,
      relativeTimestampMs: relative,
      timestampLabel: formatRelative(relative),
      jumpAffordance: { seq: e.seq, label: `Jump to step ${e.seq}` },
    };
  });
}
// === FILE END ===