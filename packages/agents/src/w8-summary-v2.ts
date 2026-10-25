// === FILE START ===
// packages/agents/src/w8-summary-v2.ts
// PRD §17.1 · W8 close-out · T-13.
//
// The W8 close-out audit. Mirrors the W7 pattern (see wave-summary-v2.ts) but
// for W8: interactive replay and interactive fork as the UI-facing bridge
// over the pure W7 primitives.
//
// Zero external imports.

export type Wave = 'W8';

export interface W8FeatureEntry {
  id: string;
  prdRef: string;
  name: string;
  modules: string[];
  testFiles: string[];
  status: 'shipped';
}

export const W8_FEATURES: readonly W8FeatureEntry[] = Object.freeze([
  Object.freeze({
    id: 'F-098',
    prdRef: 'FR-AGENT-06',
    name: 'Interactive replay view — UI render contract over recorded trace',
    modules: ['replay-view-v2.ts'],
    testFiles: ['replay-view-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-098',
    prdRef: 'FR-AGENT-06',
    name: 'Interactive fork view — two-column diverging timeline',
    modules: ['fork-view-v2.ts'],
    testFiles: ['fork-view-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'T-§15.5',
    prdRef: '§15.5',
    name: 'Stranger-readable trace + fork UI contract (capability 5)',
    modules: ['replay-view-v2.ts', 'fork-view-v2.ts'],
    testFiles: ['replay-view-v2.test.ts', 'fork-view-v2.test.ts'],
    status: 'shipped' as const,
  }),
]);

export interface W8Summary {
  wave: Wave;
  featureCount: number;
  modules: string[];
  testFiles: string[];
  textSummary: string;
}

export function summariseW8(): W8Summary {
  const moduleSet = new Set<string>();
  const testFileSet = new Set<string>();
  const ids: string[] = [];

  for (const f of W8_FEATURES) {
    ids.push(f.id);
    for (const m of f.modules) moduleSet.add(m);
    for (const t of f.testFiles) testFileSet.add(t);
  }

  const modules = Array.from(moduleSet).sort();
  const testFiles = Array.from(testFileSet).sort();

  const textSummary =
    `W8 close-out: ${W8_FEATURES.length} feature entries ` +
    `(${ids.join(', ')}). ` +
    `${modules.length} source module${modules.length === 1 ? '' : 's'} across ` +
    `${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}. ` +
    `PRD references satisfied: FR-AGENT-06, §15.5.`;

  return {
    wave: 'W8',
    featureCount: W8_FEATURES.length,
    modules,
    testFiles,
    textSummary,
  };
}
// === FILE END ===