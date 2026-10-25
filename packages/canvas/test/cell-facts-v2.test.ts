// === FILE START ===
// packages/canvas/test/cell-facts-v2.test.ts
// PRD §14.3 · §8.12 · FR-TRUTH-19 · F-043 · T-13.

import { describe, it, expect } from 'vitest';
import {
  annotate,
  getCellFact,
  findOrphanCells,
  CellFactError,
  type CellFact,
} from '../src/cell-facts-v2.js';
import type { Table } from '../src/spreadsheet-v2.js';

function sampleTable(): Table {
  return {
    headers: ['A', 'B'],
    rows: [
      ['1', 'alpha'],
      ['2', ''],
      ['3', 'gamma'],
    ],
  };
}

describe('cell-facts — annotate', () => {
  it('returns a new AnnotatedTable with the facts attached', () => {
    const t = sampleTable();
    const facts: CellFact[] = [
      {
        row: 0,
        col: 0,
        claimId: 'c1',
        value: '1',
        source: 'file',
        score: 90,
        status: 'VERIFIED',
      },
    ];
    const at = annotate(t, facts);
    expect(at.cellFacts.length).toBe(1);
    expect(at.rows.length).toBe(t.rows.length);
  });

  it('rejects a fact whose value does not match the cell', () => {
    expect(() =>
      annotate(sampleTable(), [
        {
          row: 0,
          col: 0,
          claimId: 'c1',
          value: 'mismatch',
          source: 'file',
          score: 90,
          status: 'VERIFIED',
        },
      ]),
    ).toThrow(CellFactError);
  });

  it('rejects a fact pointing at an empty cell', () => {
    expect(() =>
      annotate(sampleTable(), [
        {
          row: 1,
          col: 1,
          claimId: 'c1',
          value: '',
          source: 'file',
          score: 90,
          status: 'VERIFIED',
        },
      ]),
    ).toThrow(CellFactError);
  });
});

describe('cell-facts — getCellFact', () => {
  it('returns the fact at an annotated cell', () => {
    const at = annotate(sampleTable(), [
      {
        row: 0,
        col: 0,
        claimId: 'c1',
        value: '1',
        source: 'file',
        score: 90,
        status: 'VERIFIED',
      },
    ]);
    const f = getCellFact(at, 0, 0);
    expect(f).not.toBeNull();
    expect(f!.claimId).toBe('c1');
  });

  it('returns null when no fact is attached', () => {
    const at = annotate(sampleTable(), []);
    expect(getCellFact(at, 0, 0)).toBeNull();
  });

  it('returns the fact for the correct row+col pair', () => {
    const at = annotate(sampleTable(), [
      {
        row: 2,
        col: 0,
        claimId: 'c2',
        value: '3',
        source: 'web',
        score: 80,
        status: 'SUPPORTED',
      },
    ]);
    expect(getCellFact(at, 0, 0)).toBeNull();
    expect(getCellFact(at, 2, 0)?.claimId).toBe('c2');
  });
});

describe('cell-facts — findOrphanCells', () => {
  it('lists every non-empty cell without a fact', () => {
    const at = annotate(sampleTable(), [
      {
        row: 0,
        col: 0,
        claimId: 'c1',
        value: '1',
        source: 'file',
        score: 90,
        status: 'VERIFIED',
      },
    ]);
    // Non-empty cells in sampleTable: (0,0)=1, (0,1)=alpha, (1,0)=2,
    // (2,0)=3, (2,1)=gamma. Only (0,0) is annotated, so 4 orphans.
    expect(findOrphanCells(at).length).toBe(4);
  });

  it('returns an empty array when every non-empty cell has a fact', () => {
    const t: Table = {
      headers: ['A'],
      rows: [['1'], ['2']],
    };
    const at = annotate(t, [
      {
        row: 0,
        col: 0,
        claimId: 'c1',
        value: '1',
        source: 'file',
        score: 90,
        status: 'VERIFIED',
      },
      {
        row: 1,
        col: 0,
        claimId: 'c2',
        value: '2',
        source: 'file',
        score: 85,
        status: 'VERIFIED',
      },
    ]);
    expect(findOrphanCells(at)).toEqual([]);
  });
});

describe('cell-facts — source scan', () => {
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

  it('cell-facts-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'cell-facts-v2.ts'),
      'utf8',
    );
    const external = extractSpecifiers(src).filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('cell-facts-v2.ts has zero model imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'cell-facts-v2.ts'),
      'utf8',
    );
    expect(src).not.toMatch(
      /onnxruntime|@xenova|tensorflow|transformers\.js/i,
    );
  });
});
// === FILE END ===