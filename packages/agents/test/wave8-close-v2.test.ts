// === FILE START ===
// packages/agents/test/wave8-close-v2.test.ts
// PRD §17.1 · W8 complete close-out.

import { describe, it, expect } from 'vitest';
import {
  W8_COMPLETE,
  summariseWave8,
} from '../src/wave8-close-v2.js';

describe('wave8-close — register shape', () => {
  it('every entry has a non-empty id, prdRef, name', () => {
    for (const f of W8_COMPLETE) {
      expect(typeof f.id).toBe('string');
      expect(f.id.length).toBeGreaterThan(0);
      expect(typeof f.prdRef).toBe('string');
      expect(f.prdRef.length).toBeGreaterThan(0);
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry has at least one module and one test file', () => {
    for (const f of W8_COMPLETE) {
      expect(f.modules.length).toBeGreaterThan(0);
      expect(f.testFiles.length).toBeGreaterThan(0);
    }
  });

  it('every entry is status "shipped"', () => {
    for (const f of W8_COMPLETE) {
      expect(f.status).toBe('shipped');
    }
  });
});

describe('wave8-close — required PRD references', () => {
  it('all four required PRD references are present', () => {
    const refs = new Set(W8_COMPLETE.map((f) => f.prdRef));
    expect(refs.has('FR-AGENT-06')).toBe(true);
    expect(refs.has('FR-AGENT-02')).toBe(true);
    expect(refs.has('§10.4')).toBe(true);
    expect(refs.has('§13.7')).toBe(true);
  });

  it('all four required module names appear in the register', () => {
    const modules = new Set<string>();
    for (const f of W8_COMPLETE) for (const m of f.modules) modules.add(m);
    expect(modules.has('replay-view-v2.ts')).toBe(true);
    expect(modules.has('fork-view-v2.ts')).toBe(true);
    expect(modules.has('durable-mission-v2.ts')).toBe(true);
    expect(modules.has('queue-resume-v2.ts')).toBe(true);
  });
});

describe('wave8-close — summariseWave8 receipt', () => {
  it('returns the W8 wave and the correct entry count', () => {
    const s = summariseWave8();
    expect(s.wave).toBe('W8');
    expect(s.entryCount).toBe(W8_COMPLETE.length);
  });

  it('modules list is deduplicated and sorted', () => {
    const s = summariseWave8();
    const seen = new Set<string>();
    for (const m of s.modules) {
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
    const sorted = [...s.modules].sort();
    expect(s.modules).toEqual(sorted);
  });

  it('test files list is deduplicated', () => {
    const s = summariseWave8();
    const seen = new Set<string>();
    for (const t of s.testFiles) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('text summary mentions W8 and FR-AGENT-06 and FR-AGENT-02', () => {
    const s = summariseWave8();
    expect(s.textSummary).toContain('W8 complete');
    expect(s.textSummary).toContain('FR-AGENT-06');
    expect(s.textSummary).toContain('FR-AGENT-02');
  });
});

describe('wave8-close — declared files exist on disk', () => {
  it('every declared module exists under packages/agents/src', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const s = summariseWave8();
    for (const m of s.modules) {
      const p = path.resolve(__dirname, '..', 'src', m);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('every declared test file exists under packages/agents/test', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const s = summariseWave8();
    for (const t of s.testFiles) {
      const p = path.resolve(__dirname, t);
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});

describe('wave8-close — source scan', () => {
  it('source scan: wave8-close-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'wave8-close-v2.ts'),
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