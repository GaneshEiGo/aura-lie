// === FILE START ===
// packages/agents/test/wave-later-v2.test.ts
// PRD §17.1 · Later wave close-out.

import { describe, it, expect } from 'vitest';
import {
  LATER_FEATURES,
  summariseLater,
} from '../src/wave-later-v2.js';

describe('wave-later — register shape', () => {
  it('has the expected number of entries', () => {
    expect(LATER_FEATURES.length).toBe(8);
  });

  it('every entry has a non-empty id, prdRef, name', () => {
    for (const f of LATER_FEATURES) {
      expect(typeof f.id).toBe('string');
      expect(f.id.length).toBeGreaterThan(0);
      expect(typeof f.prdRef).toBe('string');
      expect(f.prdRef.length).toBeGreaterThan(0);
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry is status "shipped"', () => {
    for (const f of LATER_FEATURES) {
      expect(f.status).toBe('shipped');
    }
  });
});

describe('wave-later — required PRD references', () => {
  it('F-230 through F-236 and F-184 are present', () => {
    const ids = new Set(LATER_FEATURES.map((f) => f.id));
    for (const id of ['F-230', 'F-231', 'F-232', 'F-233', 'F-184', 'F-236']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('F-283 (self-host appendix) is present', () => {
    const ids = new Set(LATER_FEATURES.map((f) => f.id));
    expect(ids.has('F-283')).toBe(true);
  });

  it('FR-DEV-02 through FR-DEV-05 are all referenced', () => {
    const refs = new Set(LATER_FEATURES.map((f) => f.prdRef));
    for (const ref of ['FR-DEV-02', 'FR-DEV-03', 'FR-DEV-04', 'FR-DEV-05']) {
      expect(refs.has(ref)).toBe(true);
    }
  });
});

describe('wave-later — receipt', () => {
  it('summariseLater returns the Later wave', () => {
    expect(summariseLater().wave).toBe('Later');
  });

  it('featureCount matches the register length', () => {
    expect(summariseLater().featureCount).toBe(LATER_FEATURES.length);
  });

  it('modules list is deduplicated', () => {
    const s = summariseLater();
    const seen = new Set<string>();
    for (const m of s.modules) {
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  });

  it('test files list is deduplicated', () => {
    const s = summariseLater();
    const seen = new Set<string>();
    for (const t of s.testFiles) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('text summary mentions "Later" and FR-DEV-05', () => {
    const s = summariseLater();
    expect(s.textSummary).toContain('Later wave close-out');
    expect(s.textSummary).toContain('FR-DEV-05');
  });
});

describe('wave-later — files exist on disk', () => {
  it('every declared module exists under packages/agents/src', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const s = summariseLater();
    for (const m of s.modules) {
      const p = path.resolve(__dirname, '..', 'src', m);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('every declared test file exists under packages/agents/test', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const s = summariseLater();
    for (const t of s.testFiles) {
      const p = path.resolve(__dirname, t);
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});

describe('wave-later — source scan', () => {
  it('source scan: wave-later-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'wave-later-v2.ts'),
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