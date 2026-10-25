// === FILE START ===
// packages/canvas/test/creative-v2.test.ts
// PRD §7.13 · §7.14 · §14.4 · FR-CRE-01 to FR-CRE-03.

import { describe, it, expect } from 'vitest';
import {
  generateIdeas,
  evolveIdea,
  impossibleMode,
  labelContent,
  ALL_AXES,
  ALL_CONTENT_LABELS,
  ALL_EVOLUTION_STAGES,
  ALL_FEASIBILITY_LEVELS,
  type FeasibilityLevel,
} from '../src/creative-v2.js';

describe('creative — generateIdeas', () => {
  it('emits exactly one idea per axis', () => {
    const ideas = generateIdeas('battery life');
    expect(ideas.length).toBe(ALL_AXES.length);
    expect(new Set(ideas.map((i) => i.axis)).size).toBe(ALL_AXES.length);
  });

  it('every generated idea is labelled SPECULATIVE', () => {
    for (const idea of generateIdeas('solar')) {
      expect(idea.label).toBe('SPECULATIVE');
    }
  });

  it('each idea mentions its seed', () => {
    for (const idea of generateIdeas('graph theory')) {
      expect(idea.content).toContain('graph theory');
    }
  });

  it('rejects an empty seed', () => {
    expect(() => generateIdeas('')).toThrow();
    expect(() => generateIdeas('   ')).toThrow();
  });
});

describe('creative — evolveIdea', () => {
  it('emits the five stages in the exact PRD order', () => {
    const steps = evolveIdea('new camera');
    expect(steps.map((s) => s.stage)).toEqual(ALL_EVOLUTION_STAGES);
  });

  it('every step mentions the seed', () => {
    for (const step of evolveIdea('new camera')) {
      expect(step.content).toContain('new camera');
    }
  });

  it('rejects an empty seed', () => {
    expect(() => evolveIdea('')).toThrow();
  });
});

describe('creative — impossibleMode', () => {
  const valid: Array<{ idea: string; feasibility: FeasibilityLevel }> = [
    { idea: 'store a terabyte on a watch', feasibility: 'Currently unrealistic' },
    { idea: 'ship a weekly newsletter', feasibility: 'Already possible' },
  ];

  it('returns the labelled ideas unchanged when all are valid', () => {
    expect(impossibleMode(valid)).toEqual(valid);
  });

  it('rejects an unknown feasibility level', () => {
    const bad = [{ idea: 'x', feasibility: 'Definitely soon' as FeasibilityLevel }];
    expect(() => impossibleMode(bad)).toThrow();
  });

  it('exposes exactly the five PRD feasibility labels', () => {
    expect(ALL_FEASIBILITY_LEVELS.length).toBe(5);
    expect(ALL_FEASIBILITY_LEVELS).toContain('Already possible');
    expect(ALL_FEASIBILITY_LEVELS).toContain('Currently unrealistic');
  });
});

describe('creative — content labels', () => {
  it('exposes exactly the three PRD labels', () => {
    expect(ALL_CONTENT_LABELS.length).toBe(3);
    expect(ALL_CONTENT_LABELS).toContain('FACTUAL');
    expect(ALL_CONTENT_LABELS).toContain('SPECULATIVE');
    expect(ALL_CONTENT_LABELS).toContain('INVENTED');
  });

  it('labelContent round-trips text and label', () => {
    const out = labelContent('The sky is blue', 'FACTUAL');
    expect(out.text).toBe('The sky is blue');
    expect(out.label).toBe('FACTUAL');
  });
});

describe('creative — source scan', () => {
  function extractSpecifiers(src: string): string[] {
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    return Array.from(noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g)).map(
      (m) => m[1]!,
    );
  }

  it('creative-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'creative-v2.ts'),
      'utf8',
    );
    const external = extractSpecifiers(src).filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('creative-v2.ts has zero model imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'creative-v2.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/onnxruntime|@xenova|tensorflow|transformers\.js/i);
  });

  it('creative-v2.ts has no imports at all', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'creative-v2.ts'),
      'utf8',
    );
    expect(extractSpecifiers(src)).toEqual([]);
  });
});
// === FILE END ===