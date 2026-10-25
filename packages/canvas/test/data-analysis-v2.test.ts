// === FILE START ===
// packages/canvas/test/data-analysis-v2.test.ts
// PRD §14.5 · FR-TOOL-06 · F-185 · T-13.
//
// Shape contract (Rule 15):
//   · 5 describe blocks: empty-and-trivial, numeric-column-stats,
//     mixed-and-empty-columns, determinism, T-13-source-scan
//   · 15 it blocks total
//   · 1 import from 'vitest'
//
// T-13 source-scan tests use extractImportSpecifiers, which strips block
// comments and full-line // comments BEFORE extracting `from '...'`
// specifiers. Prose in source comments can never trip the check.

import { describe, it, expect } from 'vitest';
import { analyzeTable } from '../src/data-analysis-v2.js';
import type { Table } from '../src/spreadsheet-v2.js';

// =============================================================================
// analyzeTable — empty and trivial
// =============================================================================

describe('analyzeTable — empty and trivial', () => {
  it('empty table → 0 rows, 0 cols, 0 numeric, 0 stats', () => {
    const a = analyzeTable({ headers: [], rows: [] });
    expect(a.rows).toBe(0);
    expect(a.columns).toBe(0);
    expect(a.numericColumnCount).toBe(0);
    expect(a.columnStats).toEqual([]);
    expect(a.summary).toBe('0 rows, 0 columns. 0 numeric columns.');
  });

  it('headers only → 0 rows, all-empty columns', () => {
    const a = analyzeTable({ headers: ['A', 'B'], rows: [] });
    expect(a.rows).toBe(0);
    expect(a.columns).toBe(2);
    expect(a.columnStats.every((s) => s.kind === 'empty')).toBe(true);
    expect(a.summary).toBe('0 rows, 2 columns. 0 numeric columns.');
  });
});

// =============================================================================
// analyzeTable — numeric column stats
// =============================================================================

describe('analyzeTable — numeric column stats', () => {
  const table: Table = {
    headers: ['N', 'Label'],
    rows: [
      ['10', 'alpha'],
      ['20', 'beta'],
      ['30', 'gamma'],
    ],
  };

  it('classifies N as numeric, Label as text', () => {
    const a = analyzeTable(table);
    const n = a.columnStats.find((s) => s.name === 'N')!;
    const l = a.columnStats.find((s) => s.name === 'Label')!;
    expect(n.kind).toBe('numeric');
    expect(l.kind).toBe('text');
  });

  it('numeric column has correct min / max / mean / sum', () => {
    const a = analyzeTable(table);
    const n = a.columnStats.find((s) => s.name === 'N')!;
    expect(n.min).toBe(10);
    expect(n.max).toBe(30);
    expect(n.mean).toBe(20);
    expect(n.sum).toBe(60);
    expect(n.nonEmptyCount).toBe(3);
  });

  it('text column has null min / max / mean / sum', () => {
    const a = analyzeTable(table);
    const l = a.columnStats.find((s) => s.name === 'Label')!;
    expect(l.min).toBeNull();
    expect(l.max).toBeNull();
    expect(l.mean).toBeNull();
    expect(l.sum).toBeNull();
    expect(l.nonEmptyCount).toBe(3);
  });

  it('numericColumnCount counts only numeric', () => {
    expect(analyzeTable(table).numericColumnCount).toBe(1);
  });

  it('summary uses real counts', () => {
    expect(analyzeTable(table).summary).toBe('3 rows, 2 columns. 1 numeric column.');
  });
});

// =============================================================================
// analyzeTable — mixed and empty columns
// =============================================================================

describe('analyzeTable — mixed and empty columns', () => {
  it('mixed column is not summarised numerically', () => {
    const a = analyzeTable({
      headers: ['M'],
      rows: [['1'], ['two'], ['3']],
    });
    const m = a.columnStats[0]!;
    expect(m.kind).toBe('mixed');
    expect(m.min).toBeNull();
    expect(m.mean).toBeNull();
    expect(m.nonEmptyCount).toBe(3);
  });

  it('all-empty column is classified empty', () => {
    const a = analyzeTable({
      headers: ['X'],
      rows: [[''], [''], ['']],
    });
    const x = a.columnStats[0]!;
    expect(x.kind).toBe('empty');
    expect(x.nonEmptyCount).toBe(0);
  });

  it('missing cells are skipped, not counted as empty rows', () => {
    const a = analyzeTable({
      headers: ['A', 'B'],
      rows: [['1'], ['2', '3']],
    });
    const b = a.columnStats.find((s) => s.name === 'B')!;
    expect(b.nonEmptyCount).toBe(1);
    expect(b.kind).toBe('numeric');
    expect(b.sum).toBe(3);
  });
});

// =============================================================================
// analyzeTable — determinism
// =============================================================================

describe('analyzeTable — determinism', () => {
  it('same input → identical output twice', () => {
    const t: Table = {
      headers: ['A', 'B'],
      rows: [
        ['1', 'x'],
        ['2', 'y'],
      ],
    };
    const a1 = analyzeTable(t);
    const a2 = analyzeTable(t);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
  });

  it('padded column count from longer rows is honoured', () => {
    const a = analyzeTable({
      headers: ['A'],
      rows: [['1', '2', '3']],
    });
    expect(a.columns).toBe(3);
  });
});

// =============================================================================
// T-13 source scan (relative-only imports, comments stripped first)
// =============================================================================

describe('analysis — T-13 source scan', () => {
  /**
   * Rule 10: source-scan tests strip comments first, so prose can never
   * trip the check. We drop block comments wholesale, then full-line //
   * comments (they cannot contain import statements in valid TypeScript),
   * then extract `from '...'` specifiers from the remaining code.
   */
  function extractImportSpecifiers(src: string): string[] {
    const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    return Array.from(
      withoutLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
  }

  it('data-analysis-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'data-analysis-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    const external = extractImportSpecifiers(src).filter(
      (m) => !m.startsWith('.'),
    );
    expect(external).toEqual([]);
  });

  it('csv-export-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'csv-export-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    const external = extractImportSpecifiers(src).filter(
      (m) => !m.startsWith('.'),
    );
    expect(external).toEqual([]);
  });

  it('spreadsheet-v2.ts has zero imports at all', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'spreadsheet-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    expect(extractImportSpecifiers(src)).toEqual([]);
  });
});
// === FILE END ===