// === FILE START ===
// packages/agents/test/blueprints-v2.test.ts
// PRD §10.9 · FR-AGENT-08 · F-103.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateBlueprint,
  saveBlueprint,
  loadBlueprint,
  listBlueprints,
  clearRegistry,
  exportBlueprint,
  importBlueprint,
  type Blueprint,
} from '../src/blueprints-v2.js';

function validBlueprint(): Blueprint {
  return {
    id: 'weekly-digest',
    name: 'Weekly digest',
    description: 'Summarise the week and list open loops.',
    steps: [
      { kind: 'read', description: 'Read the last 7 turns.' },
      { kind: 'verify', description: 'Check claims against sources.', modelRole: 'judge' },
      { kind: 'synthesise', description: 'Produce a one-screen summary.' },
      { kind: 'write', description: 'Save as markdown.' },
    ],
    outputFormat: 'markdown',
  };
}

beforeEach(() => {
  clearRegistry();
});

describe('blueprints — validation accepts good data', () => {
  it('accepts a well-formed blueprint', () => {
    const r = validateBlueprint(validBlueprint());
    expect(r.ok).toBe(true);
  });

  it('rejects an empty id', () => {
    const bp = { ...validBlueprint(), id: '' };
    const r = validateBlueprint(bp);
    expect(r.ok).toBe(false);
  });

  it('rejects an empty name', () => {
    const bp = { ...validBlueprint(), name: '' };
    const r = validateBlueprint(bp);
    expect(r.ok).toBe(false);
  });

  it('rejects missing steps', () => {
    const bp = { ...validBlueprint(), steps: [] };
    const r = validateBlueprint(bp);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    expect(validateBlueprint('nope').ok).toBe(false);
    expect(validateBlueprint(null).ok).toBe(false);
    expect(validateBlueprint([]).ok).toBe(false);
  });
});

describe('blueprints — safety: never executable', () => {
  it('rejects a top-level "code" field', () => {
    const bp = { ...validBlueprint(), code: 'console.log(1)' };
    const r = validateBlueprint(bp);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });

  it('rejects a nested "exec" field inside a step', () => {
    const bp = validBlueprint();
    (bp.steps[0] as unknown as Record<string, unknown>)['exec'] = 'rm -rf /';
    const r = validateBlueprint(bp);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain('forbidden');
  });
});

describe('blueprints — save, load, list', () => {
  it('saves and loads a blueprint by id', () => {
    const bp = validBlueprint();
    saveBlueprint(bp);
    const back = loadBlueprint(bp.id);
    expect(back).not.toBeNull();
    expect(back!.id).toBe(bp.id);
    expect(back!.steps.length).toBe(bp.steps.length);
  });

  it('load of an unknown id returns null', () => {
    expect(loadBlueprint('missing')).toBeNull();
  });

  it('list returns every saved blueprint', () => {
    saveBlueprint(validBlueprint());
    saveBlueprint({ ...validBlueprint(), id: 'b2', name: 'Second' });
    expect(listBlueprints().length).toBe(2);
  });
});

describe('blueprints — export and import', () => {
  it('export → import round-trips a valid blueprint', () => {
    const bp = validBlueprint();
    const json = exportBlueprint(bp);
    const r = importBlueprint(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint.id).toBe(bp.id);
    expect(r.blueprint.name).toBe(bp.name);
    expect(r.blueprint.steps.length).toBe(bp.steps.length);
    expect(r.blueprint.outputFormat).toBe(bp.outputFormat);
  });

  it('import rejects invalid JSON', () => {
    const r = importBlueprint('{ not json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('invalid JSON');
  });

  it('source scan: blueprints-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'blueprints-v2.ts'),
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