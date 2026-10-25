// === FILE START ===
// packages/agents/test/plugins-v2.test.ts
// PRD §14.8 · FR-DEV-02.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validatePlugin,
  installPlugin,
  listPlugins,
  uninstallPlugin,
  clearRegistry,
  pluginHasPermission,
  type PluginManifest,
} from '../src/plugins-v2.js';

function goodPlugin(): PluginManifest {
  return {
    id: 'weather',
    name: 'Open-Meteo weather',
    version: '1.0.0',
    kind: 'tool',
    description: 'Fetch the forecast for a city.',
    permissions: ['read:web'],
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { tempC: { type: 'number' } } },
  };
}

beforeEach(() => {
  clearRegistry();
});

describe('plugins — validation accepts good data', () => {
  it('accepts a well-formed tool plugin', () => {
    const r = validatePlugin(goodPlugin());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.id).toBe('weather');
    expect(r.manifest.kind).toBe('tool');
  });

  it('rejects an empty id', () => {
    expect(validatePlugin({ ...goodPlugin(), id: '' }).ok).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(validatePlugin({ ...goodPlugin(), name: '' }).ok).toBe(false);
  });

  it('rejects an empty version', () => {
    expect(validatePlugin({ ...goodPlugin(), version: '' }).ok).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(validatePlugin({ ...goodPlugin(), kind: 'shell' }).ok).toBe(false);
  });

  it('rejects an unknown permission', () => {
    expect(validatePlugin({ ...goodPlugin(), permissions: ['root:everything'] }).ok).toBe(false);
  });
});

describe('plugins — safety: never executable', () => {
  it('rejects a top-level "code" field', () => {
    const bad = { ...goodPlugin(), code: 'console.log(1)' };
    const r = validatePlugin(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });

  it('rejects a nested "exec" inside inputSchema', () => {
    const bad = goodPlugin();
    (bad.inputSchema as Record<string, unknown>)['exec'] = 'rm -rf /';
    const r = validatePlugin(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });
});

describe('plugins — registry round-trips', () => {
  it('install → list → uninstall works', () => {
    const p = goodPlugin();
    installPlugin(p);
    expect(listPlugins().length).toBe(1);
    expect(uninstallPlugin(p.id)).toBe(true);
    expect(listPlugins().length).toBe(0);
    expect(uninstallPlugin('missing')).toBe(false);
  });

  it('re-installing the same id replaces the entry (no duplicates)', () => {
    installPlugin(goodPlugin());
    installPlugin({ ...goodPlugin(), name: 'Weather, updated' });
    const list = listPlugins();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe('Weather, updated');
  });

  it('pluginHasPermission returns true for listed permissions and false otherwise', () => {
    const p = goodPlugin();
    expect(pluginHasPermission(p, 'read:web')).toBe(true);
    expect(pluginHasPermission(p, 'send')).toBe(false);
    expect(pluginHasPermission(p, 'delete')).toBe(false);
  });
});

describe('plugins — source scan', () => {
  it('source scan: plugins-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'plugins-v2.ts'),
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