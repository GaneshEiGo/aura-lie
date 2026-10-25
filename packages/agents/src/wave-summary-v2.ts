// === FILE START ===
// packages/agents/src/wave-summary-v2.ts
// PRD §17.1 · W7 close-out · T-13.
//
// The W7 close-out audit. Declares every feature the wave shipped, the PRD
// reference it satisfies, the source modules that deliver it, and the test
// files that prove it. `summariseWave()` produces a deduplicated receipt.
//
// This is the "nothing disappears silently" contract (PRD §17.1 and §16.1):
// every F-### and FR-### that W7 claims must be visible here with a file on
// disk. The audit test asserts presence and shape; the test run is the gate.
//
// Zero external imports.

export type Wave = 'W7';

export interface WaveFeatureEntry {
  /** Feature ID from Section 16. */
  id: string;
  /** PRD reference: FR-###, §N.N, or the W8-bridge note. */
  prdRef: string;
  /** One-line name for the receipt. */
  name: string;
  /** Source modules under packages/agents/src/. */
  modules: string[];
  /** Test files under packages/agents/test/. */
  testFiles: string[];
  status: 'shipped';
}

export const W7_FEATURES: readonly WaveFeatureEntry[] = Object.freeze([
  Object.freeze({
    id: 'F-096',
    prdRef: 'FR-AGENT-01',
    name: 'Goal stack with dependencies and cycle-safe topological order',
    modules: ['goals-v2.ts'],
    testFiles: ['goals-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-097',
    prdRef: 'FR-AGENT-02',
    name: 'Mission runner as a pure, resumable state machine',
    modules: ['mission-runner-v2.ts'],
    testFiles: ['mission-runner-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-099',
    prdRef: 'FR-AGENT-01',
    name: 'Dry-run plan summary (counts + irreversibility flag, one line)',
    modules: ['dry-run-v2.ts'],
    testFiles: ['dry-run-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-100',
    prdRef: 'FR-AGENT-03',
    name: 'Eight stop conditions in deterministic priority order',
    modules: ['mission-runner-v2.ts'],
    testFiles: ['mission-runner-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-102',
    prdRef: 'FR-AGENT-07',
    name: 'One-sentence agent parser with confirmation card',
    modules: ['one-sentence-v2.ts'],
    testFiles: ['one-sentence-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-103',
    prdRef: 'FR-AGENT-08',
    name: 'Blueprints as plain data files, never executable',
    modules: ['blueprints-v2.ts'],
    testFiles: ['blueprints-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-094',
    prdRef: '§10.9',
    name: 'Opportunity engine — proposes only, never executes',
    modules: ['opportunity-v2.ts'],
    testFiles: ['opportunity-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-098',
    prdRef: 'FR-AGENT-06',
    name: 'Agent replay, fork and compare — the W8 bridge',
    modules: ['replay-v2.ts', 'fork-v2.ts', 'compare-v2.ts'],
    testFiles: ['replay-v2.test.ts', 'fork-v2.test.ts', 'compare-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'T-§15.5',
    prdRef: '§15.5',
    name: 'Five capability scenarios plus end-to-end mission flow',
    modules: ['scenarios-v2.ts', 'mission-scenario-v2.ts'],
    testFiles: ['scenarios-v2.test.ts', 'mission-scenario-v2.test.ts'],
    status: 'shipped' as const,
  }),
]);

export interface WaveSummary {
  wave: Wave;
  featureCount: number;
  modules: string[];
  testFiles: string[];
  textSummary: string;
}

export function summariseWave(): WaveSummary {
  const moduleSet = new Set<string>();
  const testFileSet = new Set<string>();
  const ids: string[] = [];

  for (const f of W7_FEATURES) {
    ids.push(f.id);
    for (const m of f.modules) moduleSet.add(m);
    for (const t of f.testFiles) testFileSet.add(t);
  }

  const modules = Array.from(moduleSet).sort();
  const testFiles = Array.from(testFileSet).sort();

  const textSummary =
    `W7 close-out: ${W7_FEATURES.length} features shipped ` +
    `(${ids.join(', ')}). ` +
    `${modules.length} source module${modules.length === 1 ? '' : 's'} across ` +
    `${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}. ` +
    `PRD references satisfied: ` +
    `FR-AGENT-01, FR-AGENT-02, FR-AGENT-03, FR-AGENT-06, FR-AGENT-07, ` +
    `FR-AGENT-08, §10.9, §15.5.`;

  return {
    wave: 'W7',
    featureCount: W7_FEATURES.length,
    modules,
    testFiles,
    textSummary,
  };
}
// === FILE END ===