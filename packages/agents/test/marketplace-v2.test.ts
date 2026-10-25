// === FILE START ===
// packages/agents/test/marketplace-v2.test.ts
// PRD §14.7 · §14.8 · F-236.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateMarketplaceEntry,
  saveMarketplaceEntry,
  listMarketplaceEntries,
  filterMarketplaceEntries,
  clearMarketplaceRegistry,
  exportMarketplaceEntry,
  importMarketplaceEntry,
  type MarketplaceEntry,
} from '../src/marketplace-v2.js';

function goodEntry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'yuki-skin',
    kind: 'persona',
    name: 'Yuki — analyst skin',
    version: '1.0.0',
    description: 'Short-sentence analyst persona.',
    author: 'community',
    tags: ['analyst', 'short'],
    payload: { sliders: { warmth: 0.25, bluntness: 0.7 } },
    ...over,
  };
}

beforeEach(() => {
  clearMarketplaceRegistry();
});

describe('marketplace — validation accepts good data', () => {
  it('accepts a well-formed persona entry', () => {
    const r = validateMarketplaceEntry(goodEntry());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.id).toBe('yuki-skin');
    expect(r.entry.kind).toBe('persona');
  });

  it('rejects an empty id', () => {
    expect(validateMarketplaceEntry(goodEntry({ id: '' })).ok).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(validateMarketplaceEntry(goodEntry({ name: '' })).ok).toBe(false);
  });

  it('rejects an empty version', () => {
    expect(validateMarketplaceEntry(goodEntry({ version: '' })).ok).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const bad = { ...goodEntry(), kind: 'shell-script' };
    expect(validateMarketplaceEntry(bad).ok).toBe(false);
  });
});

describe('marketplace — safety: never executable', () => {
  it('rejects a top-level "code" field', () => {
    const bad = { ...goodEntry(), code: 'console.log(1)' };
    const r = validateMarketplaceEntry(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });

  it('rejects a nested "exec" inside payload', () => {
    const bad = goodEntry();
    (bad.payload as Record<string, unknown>)['exec'] = 'rm -rf /';
    const r = validateMarketplaceEntry(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });
});

describe('marketplace — registry round-trips', () => {
  it('save → list → clear works', () => {
    saveMarketplaceEntry(goodEntry());
    expect(listMarketplaceEntries().length).toBe(1);
    saveMarketplaceEntry(goodEntry({ id: 'blueprint-1', kind: 'blueprint' }));
    expect(listMarketplaceEntries().length).toBe(2);
    clearMarketplaceRegistry();
    expect(listMarketplaceEntries().length).toBe(0);
  });
});

describe('marketplace — filtering', () => {
  it('filter by kind returns only that kind', () => {
    saveMarketplaceEntry(goodEntry({ id: 'a', kind: 'persona' }));
    saveMarketplaceEntry(goodEntry({ id: 'b', kind: 'blueprint' }));
    saveMarketplaceEntry(goodEntry({ id: 'c', kind: 'persona' }));
    const personas = filterMarketplaceEntries({ kind: 'persona' });
    expect(personas.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('filter by tag returns only entries carrying that tag', () => {
    saveMarketplaceEntry(goodEntry({ id: 'a', tags: ['analyst'] }));
    saveMarketplaceEntry(goodEntry({ id: 'b', tags: ['teacher'] }));
    const analyst = filterMarketplaceEntries({ tag: 'analyst' });
    expect(analyst.map((e) => e.id)).toEqual(['a']);
  });
});

describe('marketplace — export and import', () => {
  it('export → import round-trips a valid entry', () => {
    const e = goodEntry();
    const json = exportMarketplaceEntry(e);
    const r = importMarketplaceEntry(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.id).toBe(e.id);
    expect(r.entry.kind).toBe(e.kind);
    expect(r.entry.tags).toEqual(e.tags);
  });

  it('import rejects invalid JSON', () => {
    const r = importMarketplaceEntry('{ not json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('invalid JSON');
  });
});

describe('marketplace — source scan', () => {
  it('source scan: marketplace-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'marketplace-v2.ts'),
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