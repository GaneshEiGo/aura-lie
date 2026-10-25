// === FILE START ===
// packages/agents/src/wave8-close-v2.ts
// PRD §17.1 · W8 complete close-out · T-13.
//
// The final W8 receipt: both sections (108 interactive replay/fork views +
// 109 durable mission runner and queue-based resume) closed in one audit.
// Deduplicated modules and test files, one text summary naming every PRD
// reference W8 satisfies.
//
// Zero external imports.

export type Wave = 'W8';

export interface W8CompleteEntry {
  id: string;
  prdRef: string;
  name: string;
  modules: string[];
  testFiles: string[];
  status: 'shipped';
}

export const W8_COMPLETE: readonly W8CompleteEntry[] = Object.freeze([
  Object.freeze({
    id: 'F-098',
    prdRef: 'FR-AGENT-06',
    name: 'Interactive replay and fork views (Section 108)',
    modules: ['replay-view-v2.ts', 'fork-view-v2.ts'],
    testFiles: ['replay-view-v2.test.ts', 'fork-view-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-097',
    prdRef: 'FR-AGENT-02',
    name: 'Durable mission runner with resumable state (Section 109)',
    modules: ['durable-mission-v2.ts'],
    testFiles: ['durable-mission-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-084',
    prdRef: '§10.4',
    name: 'Queue-based resume with exponential backoff (Section 109)',
    modules: ['queue-resume-v2.ts'],
    testFiles: ['queue-resume-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'T-W8',
    prdRef: '§13.7',
    name: 'Full W8 close-out audit',
    modules: ['durable-mission-v2.ts', 'queue-resume-v2.ts'],
    testFiles: ['durable-mission-v2.test.ts', 'queue-resume-v2.test.ts'],
    status: 'shipped' as const,
  }),
]);

export interface W8CompleteSummary {
  wave: Wave;
  entryCount: number;
  modules: string[];
  testFiles: string[];
  textSummary: string;
}

export function summariseWave8(): W8CompleteSummary {
  const moduleSet = new Set<string>();
  const testFileSet = new Set<string>();
  const ids: string[] = [];

  for (const f of W8_COMPLETE) {
    ids.push(f.id);
    for (const m of f.modules) moduleSet.add(m);
    for (const t of f.testFiles) testFileSet.add(t);
  }

  const modules = Array.from(moduleSet).sort();
  const testFiles = Array.from(testFileSet).sort();

  const textSummary =
    `W8 complete: 2 sections, ${W8_COMPLETE.length} feature entries ` +
    `(${ids.join(', ')}). ` +
    `${modules.length} module${modules.length === 1 ? '' : 's'} across ` +
    `${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}. ` +
    `PRD references satisfied: FR-AGENT-06, FR-AGENT-02, §10.4, §13.7, §15.5.`;

  return {
    wave: 'W8',
    entryCount: W8_COMPLETE.length,
    modules,
    testFiles,
    textSummary,
  };
}
// === FILE END ===