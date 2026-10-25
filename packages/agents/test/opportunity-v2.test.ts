// === FILE START ===
// packages/agents/test/opportunity-v2.test.ts
// PRD §10.9 · F-094.

import { describe, it, expect } from 'vitest';
import {
  findOpportunities,
  type ProjectCapability,
  type ProposedExtension,
} from '../src/opportunity-v2.js';

const CAPS: readonly ProjectCapability[] = [
  { id: 'cloudflare', name: 'Cloudflare Worker', evidenceCount: 3 },
  { id: 'indexeddb', name: 'IndexedDB store', evidenceCount: 5 },
  { id: 'claims', name: 'Claim extraction', evidenceCount: 2 },
];

function ext(over: Partial<ProposedExtension> = {}): ProposedExtension {
  return {
    id: 'weekly-digest',
    name: 'Weekly digest',
    description: 'Summarise the week and list open loops.',
    requiredCapabilities: ['cloudflare', 'indexeddb', 'claims'],
    ...over,
  };
}

describe('opportunity — thresholds', () => {
  it('empty capabilities and candidates → []', () => {
    expect(findOpportunities([], [])).toEqual([]);
  });

  it('all capabilities present → pursue with confidence 100', () => {
    const out = findOpportunities(CAPS, [ext()]);
    expect(out.length).toBe(1);
    expect(out[0]!.recommendation).toBe('pursue');
    expect(out[0]!.confidence).toBe(100);
    expect(out[0]!.missing).toEqual([]);
  });

  it('partial coverage → wait', () => {
    const out = findOpportunities(CAPS, [
      ext({ requiredCapabilities: ['cloudflare', 'indexeddb', 'vectordb'] }),
    ]);
    expect(out[0]!.recommendation).toBe('wait');
    expect(out[0]!.missing).toEqual(['vectordb']);
  });

  it('no coverage → skip', () => {
    const out = findOpportunities(CAPS, [
      ext({ requiredCapabilities: ['foo', 'bar', 'baz', 'qux'] }),
    ]);
    expect(out[0]!.recommendation).toBe('skip');
    expect(out[0]!.confidence).toBe(0);
  });
});

describe('opportunity — evidence and rationale', () => {
  it('evidence lists the capability IDs the project already has', () => {
    const out = findOpportunities(CAPS, [ext()]);
    expect(out[0]!.evidence.sort()).toEqual(['claims', 'cloudflare', 'indexeddb']);
  });

  it('missing lists the capability IDs the project lacks', () => {
    const out = findOpportunities(CAPS, [
      ext({ requiredCapabilities: ['cloudflare', 'vectordb'] }),
    ]);
    expect(out[0]!.missing).toEqual(['vectordb']);
  });

  it('rationale names the missing capabilities when there are any', () => {
    const out = findOpportunities(CAPS, [
      ext({ requiredCapabilities: ['cloudflare', 'vectordb', 'embedder'] }),
    ]);
    expect(out[0]!.rationale).toContain('vectordb');
    expect(out[0]!.rationale).toContain('embedder');
  });

  it('a capability with evidenceCount 0 counts as missing', () => {
    const caps = [
      { id: 'cloudflare', name: 'CF', evidenceCount: 0 },
    ];
    const out = findOpportunities(caps, [ext({ requiredCapabilities: ['cloudflare'] })]);
    expect(out[0]!.missing).toEqual(['cloudflare']);
    expect(out[0]!.recommendation).toBe('skip');
  });
});

describe('opportunity — shape and ordering', () => {
  it('confidence is always between 0 and 100', () => {
    const out = findOpportunities(CAPS, [
      ext({ id: 'a', requiredCapabilities: [] }),
      ext({ id: 'b', requiredCapabilities: ['cloudflare'] }),
      ext({ id: 'c', requiredCapabilities: ['cloudflare', 'indexeddb', 'claims', 'x'] }),
    ]);
    for (const p of out) {
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('multiple candidates are sorted: pursue → wait → skip', () => {
    const out = findOpportunities(CAPS, [
      ext({ id: 'pursue', requiredCapabilities: ['cloudflare', 'indexeddb', 'claims'] }),
      ext({ id: 'wait', requiredCapabilities: ['cloudflare', 'vectordb'] }),
      ext({ id: 'skip', requiredCapabilities: ['foo', 'bar', 'baz', 'qux'] }),
    ]);
    expect(out.map((p) => p.extension.id)).toEqual(['pursue', 'wait', 'skip']);
  });

  it('an extension with no required capabilities → confidence 100, pursue', () => {
    const out = findOpportunities(CAPS, [
      ext({ requiredCapabilities: [] }),
    ]);
    expect(out[0]!.confidence).toBe(100);
    expect(out[0]!.recommendation).toBe('pursue');
  });
});

describe('opportunity — never auto-executes', () => {
  it('is pure: same inputs → identical outputs, inputs unchanged', () => {
    const capsBefore = JSON.stringify(CAPS);
    const candBefore = JSON.stringify([ext()]);
    const a = findOpportunities(CAPS, [ext()]);
    const b = findOpportunities(CAPS, [ext()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(CAPS)).toBe(capsBefore);
    expect(JSON.stringify([ext()])).toBe(candBefore);
  });

  it('source scan: opportunity-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'opportunity-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===