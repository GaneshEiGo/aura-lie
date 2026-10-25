// === FILE START ===
// packages/canvas/test/csv-export-v2.test.ts
// PRD §14.3 · FR-CANVAS-05 · T-13.
//
// The 4 round-trip tests (writeCSV then parseCSV, compare to original) are
// the actual contract this module must uphold. The 6 basic/escaping tests
// assert byte-exact output including the RFC 4180 trailing newline.

import { describe, it, expect } from 'vitest';
import { writeCSV } from '../src/csv-export-v2.js';
import { parseCSV, type Table } from '../src/spreadsheet-v2.js';

// =============================================================================
// Basic output (byte-exact, includes trailing newline)
// =============================================================================

describe('writeCSV — basics', () => {
  it('simple header + rows (with RFC 4180 trailing newline)', () => {
    expect(
      writeCSV({
        headers: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      }),
    ).toBe('A,B\n1,2\n3,4\n');
  });

  it('header-only table (with trailing newline)', () => {
    expect(writeCSV({ headers: ['A', 'B'], rows: [] })).toBe('A,B\n');
  });

  it('empty headers → empty string (no trailing newline)', () => {
    expect(writeCSV({ headers: [], rows: [] })).toBe('');
  });

  it('empty field is preserved (with trailing newline)', () => {
    expect(writeCSV({ headers: ['A', 'B', 'C'], rows: [['1', '', '3']] })).toBe(
      'A,B,C\n1,,3\n',
    );
  });
});

// =============================================================================
// Escaping
// =============================================================================

describe('writeCSV — escaping', () => {
  it('quotes a field containing a comma', () => {
    expect(writeCSV({ headers: ['A'], rows: [['x,y']] })).toBe('A\n"x,y"\n');
  });

  it('quotes a field containing a newline', () => {
    expect(writeCSV({ headers: ['A'], rows: [['x\ny']] })).toBe('A\n"x\ny"\n');
  });

  it('doubles embedded quotes', () => {
    expect(writeCSV({ headers: ['A'], rows: [['he said "hi"']] })).toBe(
      'A\n"he said ""hi"""\n',
    );
  });
});

// =============================================================================
// Round-trip: parseCSV(writeCSV(t)) === t for every input
// =============================================================================

describe('writeCSV ↔ parseCSV round-trip', () => {
  const cases: Table[] = [
    { headers: ['A', 'B'], rows: [] },
    {
      headers: ['Name', 'Age'],
      rows: [
        ['Alice', '30'],
        ['Bob', '25'],
      ],
    },
    {
      headers: ['Quote', 'Note'],
      rows: [
        ['he said "hi"', 'a,b'],
        ['line1\nline2', ''],
      ],
    },
    // The failing case before the trailing-newline fix: three trailing
    // empty rows collapsed to two because there was no separator after
    // the last record. The trailing newline resolves it.
    { headers: ['A'], rows: [[''], [''], ['']] },
  ];

  for (const [i, table] of cases.entries()) {
    it(`round-trips case #${i + 1}`, () => {
      const csv = writeCSV(table);
      const parsed = parseCSV(csv);
      expect(parsed).toEqual(table);
    });
  }
});
// === FILE END ===