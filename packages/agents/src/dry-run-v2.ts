// === FILE START ===
// packages/agents/src/dry-run-v2.ts
// PRD §10.9 · F-099 · T-13.
//
// Dry-run plan summary. PRD §10.9: "Before executing, Aura-lie lists planned
// reads, writes, searches and outputs, with 'no external actions will occur',
// then asks Execute."
//
// This module compiles a list of PlannedActions into a summary. It does not
// execute anything. It does not call any tool. It is a pure transformation.

export type PlannedActionKind = 'read' | 'write' | 'search' | 'run';

export interface PlannedAction {
  kind: PlannedActionKind;
  target: string;
  irreversible?: boolean;
}

export interface DryRunSummary {
  readCount: number;
  writeCount: number;
  searchCount: number;
  runCount: number;
  irreversible: boolean;
  summary: string;
}

export const DRY_RUN_PREFIX = 'Dry-run. No external actions will occur.';

export function compileDryRun(actions: readonly PlannedAction[]): DryRunSummary {
  let readCount = 0;
  let writeCount = 0;
  let searchCount = 0;
  let runCount = 0;
  let irreversible = false;

  for (const a of actions) {
    switch (a.kind) {
      case 'read':
        readCount += 1;
        break;
      case 'write':
        writeCount += 1;
        break;
      case 'search':
        searchCount += 1;
        break;
      case 'run':
        runCount += 1;
        break;
    }
    if (a.irreversible) irreversible = true;
  }

  const parts: string[] = [];
  if (readCount > 0) parts.push(`${readCount} ${readCount === 1 ? 'read' : 'reads'}`);
  if (writeCount > 0) parts.push(`${writeCount} ${writeCount === 1 ? 'write' : 'writes'}`);
  if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`);
  if (runCount > 0) parts.push(`${runCount} ${runCount === 1 ? 'run' : 'runs'}`);
  const summary =
    parts.length === 0
      ? `${DRY_RUN_PREFIX} Nothing planned.`
      : `${DRY_RUN_PREFIX} Will perform ${parts.join(', ')}.`;

  return {
    readCount,
    writeCount,
    searchCount,
    runCount,
    irreversible,
    summary,
  };
}
// === FILE END ===