// === FILE START ===
// packages/canvas/test/spreadsheet-v2.test.ts
// PRD §14.3 · FR-CANVAS-05 · F-077 · T-13.

import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  evaluateFormula,
  colToIndex,
  MAX_FORMULA_DEPTH,
  type Table,
} from '../src/spreadsheet-v2.js';

// =============================================================================
// CSV parser
// =============================================================================

describe('parseCSV — basics', () => {
  it('empty string → empty table', () => {
    expect(parseCSV('')).toEqual({ headers: [], rows: [] });
  });

  it('single line → headers only', () => {
    expect(parseCSV('a,b,c')).toEqual({
      headers: ['a', 'b', 'c'],
      rows: [],
    });
  });

  it('header + 1 row', () => {
    expect(parseCSV('a,b\n1,2')).toEqual({
      headers: ['a', 'b'],
      rows: [['1', '2']],
    });
  });

  it('header + 2 rows', () => {
    expect(parseCSV('a,b\n1,2\n3,4')).toEqual({
      headers: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('CRLF line endings', () => {
    expect(parseCSV('a,b\r\n1,2\r\n3,4')).toEqual({
      headers: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('trailing newline is tolerated', () => {
    expect(parseCSV('a,b\n1,2\n')).toEqual({
      headers: ['a', 'b'],
      rows: [['1', '2']],
    });
  });

  it('empty field is preserved', () => {
    expect(parseCSV('a,b,c\n1,,3')).toEqual({
      headers: ['a', 'b', 'c'],
      rows: [['1', '', '3']],
    });
  });
});

describe('parseCSV — quoting', () => {
  it('quoted field with embedded comma', () => {
    expect(parseCSV('a,"x,y",c')).toEqual({
      headers: ['a', 'x,y', 'c'],
      rows: [],
    });
  });

  it('quoted field with escaped quote', () => {
    expect(parseCSV('a,"he said ""hi""",c')).toEqual({
      headers: ['a', 'he said "hi"', 'c'],
      rows: [],
    });
  });

  it('quoted field with embedded newline', () => {
    expect(parseCSV('a,b\n"line1\nline2",c')).toEqual({
      headers: ['a', 'b'],
      rows: [['line1\nline2', 'c']],
    });
  });

  it('quoted field with CRLF inside stays literal', () => {
    expect(parseCSV('a\n"x\r\ny"')).toEqual({
      headers: ['a'],
      rows: [['x\r\ny']],
    });
  });
});

// =============================================================================
// Column indexing
// =============================================================================

describe('colToIndex', () => {
  it('A → 0', () => expect(colToIndex('A')).toBe(0));
  it('B → 1', () => expect(colToIndex('B')).toBe(1));
  it('Z → 25', () => expect(colToIndex('Z')).toBe(25));
  it('AA → 26', () => expect(colToIndex('AA')).toBe(26));
  it('AB → 27', () => expect(colToIndex('AB')).toBe(27));
  it('BA → 52', () => expect(colToIndex('BA')).toBe(52));
  it('ZZ → 701', () => expect(colToIndex('ZZ')).toBe(701));
  it('AAA → 702', () => expect(colToIndex('AAA')).toBe(702));
  it('empty → -1', () => expect(colToIndex('')).toBe(-1));
});

// =============================================================================
// Formula evaluation
// =============================================================================

function makeTable(): Table {
  return {
    headers: ['A', 'B', 'C'],
    rows: [
      ['10', '20', '=A1+B1'],
      ['5', '3', '=A2*B2'],
      ['text', '7', ''],
    ],
  };
}

describe('evaluateFormula — happy paths', () => {
  it('numeric literal', () => {
    const r = evaluateFormula('=42', makeTable());
    expect(r).toEqual({ value: 42, error: null, dependencies: [] });
  });

  it('cell reference pulls numeric value', () => {
    const r = evaluateFormula('=A1', makeTable());
    expect(r).toEqual({ value: 10, error: null, dependencies: ['A1'] });
  });

  it('addition of two cells', () => {
    const r = evaluateFormula('=A1+B1', makeTable());
    expect(r.value).toBe(30);
    expect(r.error).toBeNull();
    expect(r.dependencies).toEqual(['A1', 'B1']);
  });

  it('subtraction', () => {
    expect(evaluateFormula('=A1-B1', makeTable()).value).toBe(-10);
  });

  it('multiplication', () => {
    expect(evaluateFormula('=A1*B1', makeTable()).value).toBe(200);
  });

  it('division', () => {
    expect(evaluateFormula('=A1/B1', makeTable()).value).toBe(0.5);
  });

  it('parentheses override precedence', () => {
    expect(evaluateFormula('=(2+3)*4', makeTable()).value).toBe(20);
  });

  it('precedence: * before +', () => {
    expect(evaluateFormula('=2+3*4', makeTable()).value).toBe(14);
  });

  it('unary minus', () => {
    expect(evaluateFormula('=-A1', makeTable()).value).toBe(-10);
  });

  it('leading "=" is optional', () => {
    expect(evaluateFormula('A1+B1', makeTable()).value).toBe(30);
  });

  it('nested formula cell is evaluated', () => {
    // C1 = '=A1+B1' → 30.
    const r = evaluateFormula('=C1', makeTable());
    expect(r.value).toBe(30);
  });
});

describe('evaluateFormula — errors', () => {
  it('unknown cell reference → #REF!', () => {
    const r = evaluateFormula('=Z99', makeTable());
    expect(r.error).toBe('#REF!');
  });

  it('non-numeric cell value → #VALUE!', () => {
    const r = evaluateFormula('=A3+1', makeTable());
    expect(r.error).toBe('#VALUE!');
  });

  it('division by zero → #DIV/0!', () => {
    const r = evaluateFormula('=1/0', makeTable());
    expect(r.error).toBe('#DIV/0!');
  });

  it('empty formula → #VALUE!', () => {
    expect(evaluateFormula('=', makeTable()).error).toBe('#VALUE!');
    expect(evaluateFormula('', makeTable()).error).toBe('#VALUE!');
  });

  it('trailing garbage → #VALUE!', () => {
    expect(evaluateFormula('=A1 A1', makeTable()).error).toBe('#VALUE!');
  });

  it('unbalanced parens → #VALUE!', () => {
    expect(evaluateFormula('=(1+2', makeTable()).error).toBe('#VALUE!');
  });

  it('empty cell treated as 0', () => {
    const r = evaluateFormula('=C3+5', makeTable());
    expect(r.value).toBe(5);
    expect(r.error).toBeNull();
  });

  it('cyclic formulas → #CYCLE!', () => {
    // Build a table where A1 = "=B1" and B1 = "=A1".
    const cyclic: Table = {
      headers: ['A', 'B'],
      rows: [['=B1', '=A1']],
    };
    expect(evaluateFormula('=A1', cyclic).error).toBe('#CYCLE!');
    expect(MAX_FORMULA_DEPTH).toBeGreaterThan(0);
  });
});
// === FILE END ===