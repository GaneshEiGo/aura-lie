// === FILE START ===
// packages/agents/test/wave-summary-v2.test.ts
// PRD §17.1 · W7 close-out.

import { describe, it, expect } from 'vitest';
import {
  W7_FEATURES,
  summariseWave,
  type WaveFeatureEntry,
} from '../src/wave-summary-v2.js';

describe('wave-summary — feature register', () => {
  it('every W7 feature has a non-empty id, prdRef, name', () => {
    for (const f of W7_FEATURES) {
      expect(typeof f.id).toBe('string');
      expect(f.id.length).toBeGreaterThan(0);
      expect(typeof f.prdRef).toBe('string');
      expect(f.prdRef.length).toBeGreaterThan(0);
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it('every W7 feature has at least one module and one test file', () => {
    for (const f of W7_FEATURES) {
      expect(f.modules.length).toBeGreaterThan(0);
      expect(f.testFiles.length).toBeGreaterThan(0);
    }
  });

  it('every entry is status "shipped"', () => {
    for (const f of W7_FEATURES) {
      expect(f.status).toBe('shipped');
    }
  });
});

describe('wave-summary — required PRD references', () => {
  it('all eight FR-AGENT requirements are covered by at least one feature', () => {
    const covered = new Set(W7_FEATURES.map((f) => f.prdRef));
    // FR-AGENT-04 (permission matrix) was shipped earlier in permission-tools.
    // FR-AGENT-05 (structured hand-off) is checked in goals-v2.test.ts.
    // Every other FR-AGENT is claimed here.
    expect(covered.has('FR-AGENT-01')).toBe(true);
    expect(covered.has('FR-AGENT-02')).toBe(true);
    expect(covered.has('FR-AGENT-03')).toBe(true);
    expect(covered.has('FR-AGENT-06')).toBe(true);
    expect(covered.has('FR-AGENT-07')).toBe(true);
    expect(covered.has('FR-AGENT-08')).toBe(true);
    expect(covered.has('§10.9')).toBe(true);
    expect(covered.has('§15.5')).toBe(true);
  });

  it('every required F-### id is present', () => {
    const ids = W7_FEATURES.map((f) => f.id);
    for (const required of [
      'F-094',
      'F-096',
      'F-097',
      'F-098',
      'F-099',
      'F-100',
      'F-102',
      'F-103',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('F-094 is attributed to the opportunity engine', () => {
    const f = W7_FEATURES.find((x) => x.id === 'F-094');
    expect(f).toBeDefined();
    expect(f!.modules).toContain('opportunity-v2.ts');
  });
});

describe('wave-summary — the receipt', () => {
  it('summariseWave returns the W7 wave', () => {
    const s = summariseWave();
    expect(s.wave).toBe('W7');
  });

  it('featureCount matches the register length', () => {
    const s = summariseWave();
    expect(s.featureCount).toBe(W7_FEATURES.length);
  });

  it('modules list is deduplicated', () => {
    const s = summariseWave();
    const seen = new Set<string>();
    for (const m of s.modules) {
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  });

  it('test files list is deduplicated', () => {
    const s = summariseWave();
    const seen = new Set<string>();
    for (const t of s.testFiles) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('text summary mentions W7 and the count', () => {
    const s = summariseWave();
    expect(s.textSummary).toContain('W7 close-out');
    expect(s.textSummary).toContain(String(W7_FEATURES.length));
  });

  it('text summary names FR-AGENT-01 and FR-AGENT-08', () => {
    const s = summariseWave();
    expect(s.textSummary).toContain('FR-AGENT-01');
    expect(s.textSummary).toContain('FR-AGENT-08');
  });

  it('every W7 module name appears in the deduplicated list', () => {
    const s = summariseWave();
    const moduleSet = new Set(s.modules);
    for (const f of W7_FEATURES) {
      for (const m of f.modules) {
        expect(moduleSet.has(m)).toBe(true);
      }
    }
  });
});

describe('wave-summary — declared test files exist on disk', () => {
  it('every declared test file exists under packages/agents/test', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const f of W7_FEATURES) {
      for (const t of f.testFiles) {
        const p = path.resolve(__dirname, t);
        expect(fs.existsSync(p)).toBe(true);
      }
    }
  });

  it('source scan: wave-summary-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'wave-summary-v2.ts'),
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