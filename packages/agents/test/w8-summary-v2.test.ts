// === FILE START ===
// packages/agents/test/w8-summary-v2.test.ts
// PRD §17.1 · W8 close-out.

import { describe, it, expect } from 'vitest';
import {
  W8_FEATURES,
  summariseW8,
} from '../src/w8-summary-v2.js';

describe('w8-summary — register shape', () => {
  it('every entry has a non-empty id, prdRef, name', () => {
    for (const f of W8_FEATURES) {
      expect(typeof f.id).toBe('string');
      expect(f.id.length).toBeGreaterThan(0);
      expect(typeof f.prdRef).toBe('string');
      expect(f.prdRef.length).toBeGreaterThan(0);
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry has at least one module and one test file', () => {
    for (const f of W8_FEATURES) {
      expect(f.modules.length).toBeGreaterThan(0);
      expect(f.testFiles.length).toBeGreaterThan(0);
    }
  });

  it('every entry is status "shipped"', () => {
    for (const f of W8_FEATURES) {
      expect(f.status).toBe('shipped');
    }
  });
});

describe('w8-summary — required PRD references', () => {
  it('F-098 is present', () => {
    const ids = W8_FEATURES.map((f) => f.id);
    expect(ids).toContain('F-098');
  });

  it('FR-AGENT-06 is present', () => {
    const refs = W8_FEATURES.map((f) => f.prdRef);
    expect(refs).toContain('FR-AGENT-06');
  });

  it('§15.5 is present', () => {
    const refs = W8_FEATURES.map((f) => f.prdRef);
    expect(refs).toContain('§15.5');
  });
});

describe('w8-summary — the receipt', () => {
  it('summariseW8 returns the W8 wave', () => {
    const s = summariseW8();
    expect(s.wave).toBe('W8');
  });

  it('featureCount matches the register length', () => {
    const s = summariseW8();
    expect(s.featureCount).toBe(W8_FEATURES.length);
  });

  it('modules list is deduplicated', () => {
    const s = summariseW8();
    const seen = new Set<string>();
    for (const m of s.modules) {
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  });

  it('test files list is deduplicated', () => {
    const s = summariseW8();
    const seen = new Set<string>();
    for (const t of s.testFiles) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('text summary mentions W8 and FR-AGENT-06', () => {
    const s = summariseW8();
    expect(s.textSummary).toContain('W8 close-out');
    expect(s.textSummary).toContain('FR-AGENT-06');
  });

  it('every module name appears in the deduplicated list', () => {
    const s = summariseW8();
    const moduleSet = new Set(s.modules);
    for (const f of W8_FEATURES) {
      for (const m of f.modules) {
        expect(moduleSet.has(m)).toBe(true);
      }
    }
  });
});

describe('w8-summary — declared test files exist on disk', () => {
  it('every declared test file exists under packages/agents/test', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const f of W8_FEATURES) {
      for (const t of f.testFiles) {
        const p = path.resolve(__dirname, t);
        expect(fs.existsSync(p)).toBe(true);
      }
    }
  });

  it('source scan: w8-summary-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'w8-summary-v2.ts'),
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