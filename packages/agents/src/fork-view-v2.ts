// === FILE START ===
// packages/agents/src/fork-view-v2.ts
// PRD §10.9 · §15.5 · F-098 · FR-AGENT-06.
//
// W8 interactive fork view — the UI render contract for a diverged run.
// Takes the output of `forkAt()` (prefix + forkedEvents + summary) and
// produces two columns the UI renders side by side:
//
//   · leftColumn   — the unchanged prefix, every row marked 'identical'
//   · rightColumn  — the forked events, every row marked 'new'
//
// The header line names the fork point and the two counts so a stranger can
// read the whole divergence from one line.
//
// Pure. No side effects. No imports outside packages/agents/src.

import type { ForkResult } from './fork-v2.js';

export type ColumnRowStatus = 'identical' | 'new';

export interface ForkColumnRow {
  seq: number;
  kind: string;
  description: string;
  status: ColumnRowStatus;
}

export interface ForkView {
  header: string;
  forkSeq: number;
  leftColumn: ForkColumnRow[];
  rightColumn: ForkColumnRow[];
}

export function buildForkView(fork: ForkResult): ForkView {
  const forkSeq =
    fork.prefix.length > 0
      ? fork.prefix[fork.prefix.length - 1]!.seq
      : 0;

  const leftColumn: ForkColumnRow[] = fork.prefix.map((e) => ({
    seq: e.seq,
    kind: e.kind,
    description: e.description,
    status: 'identical' as ColumnRowStatus,
  }));

  const rightColumn: ForkColumnRow[] = fork.forkedEvents.map((e) => ({
    seq: e.seq,
    kind: e.kind,
    description: e.description,
    status: 'new' as ColumnRowStatus,
  }));

  const leftWord = leftColumn.length === 1 ? 'event' : 'events';
  const rightWord = rightColumn.length === 1 ? 'event' : 'events';

  const header =
    `Forked at step ${forkSeq} · ` +
    `${leftColumn.length} shared ${leftWord}, ` +
    `${rightColumn.length} new ${rightWord}`;

  return { header, forkSeq, leftColumn, rightColumn };
}
// === FILE END ===