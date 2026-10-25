// === FILE START ===
// packages/agents/src/wave-later-v2.ts
// PRD §17.1 · Later wave close-out · T-13.
//
// The Later wave receipt. Every F-### the wave shipped, the PRD reference it
// satisfies, the module that delivers it, and the test that proves it.
// `summariseLater()` produces a deduplicated receipt so nothing disappears
// silently (PRD §16.1, §17.1).
//
// Zero external imports.

export type Wave = 'Later';

export interface LaterFeatureEntry {
  id: string;
  prdRef: string;
  name: string;
  modules: string[];
  testFiles: string[];
  status: 'shipped';
}

export const LATER_FEATURES: readonly LaterFeatureEntry[] = Object.freeze([
  Object.freeze({
    id: 'F-230',
    prdRef: 'FR-DEV-05',
    name: 'Public REST API with personal tokens',
    modules: ['rest-api-v2.ts'],
    testFiles: ['rest-api-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-231',
    prdRef: 'FR-DEV-05',
    name: 'JavaScript SDK',
    modules: ['sdk-js-v2.ts'],
    testFiles: ['sdk-js-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-232',
    prdRef: 'FR-DEV-05',
    name: 'CLI',
    modules: ['cli-v2.ts'],
    testFiles: ['cli-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-233',
    prdRef: 'FR-DEV-03',
    name: 'Browser extension — Fact-check this page',
    modules: ['extension-v2.ts'],
    testFiles: ['extension-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-184',
    prdRef: 'FR-DEV-02',
    name: 'Declarative plugins — data only, never code',
    modules: ['plugins-v2.ts'],
    testFiles: ['plugins-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-184',
    prdRef: 'FR-DEV-04',
    name: 'MCP bridge — same permission matrix',
    modules: ['mcp-bridge-v2.ts'],
    testFiles: ['mcp-bridge-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-236',
    prdRef: '§14.7',
    name: 'Marketplace of persona, blueprint and plugin files',
    modules: ['marketplace-v2.ts'],
    testFiles: ['marketplace-v2.test.ts'],
    status: 'shipped' as const,
  }),
  Object.freeze({
    id: 'F-283',
    prdRef: '§17.8',
    name: 'Self-host appendix as data',
    modules: ['self-host-v2.ts'],
    testFiles: ['self-host-v2.test.ts'],
    status: 'shipped' as const,
  }),
]);

export interface LaterSummary {
  wave: Wave;
  featureCount: number;
  modules: string[];
  testFiles: string[];
  textSummary: string;
}

export function summariseLater(): LaterSummary {
  const moduleSet = new Set<string>();
  const testFileSet = new Set<string>();
  const ids: string[] = [];

  for (const f of LATER_FEATURES) {
    ids.push(f.id);
    for (const m of f.modules) moduleSet.add(m);
    for (const t of f.testFiles) testFileSet.add(t);
  }

  const modules = Array.from(moduleSet).sort();
  const testFiles = Array.from(testFileSet).sort();

  const textSummary =
    `Later wave close-out: ${LATER_FEATURES.length} feature entries ` +
    `(${ids.join(', ')}). ` +
    `${modules.length} module${modules.length === 1 ? '' : 's'} across ` +
    `${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}. ` +
    `PRD references satisfied: FR-DEV-02, FR-DEV-03, FR-DEV-04, FR-DEV-05, §14.7, §17.8.`;

  return {
    wave: 'Later',
    featureCount: LATER_FEATURES.length,
    modules,
    testFiles,
    textSummary,
  };
}
// === FILE END ===