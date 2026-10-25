// === FILE START ===
// packages/canvas/src/csv-export-v2.ts
// PRD §14.3 · FR-CANVAS-05 · T-13.
//
// RFC-4180 CSV writer. Deliberately independent of document-v2.ts's toCSV
// so that the round-trip test in csv-export-v2.test.ts can verify that
// parseCSV(writeCSV(x)) === x without depending on the document module.
//
// TRAILING NEWLINE (Section 100 fix):
//   RFC 4180 §2.2: "The last record in the file may or may not have an
//   ending line break." Both forms are valid. But when the last row is
//   entirely empty, `lines.join('\n')` produces a string with no separator
//   after the last record, and a trailing-newline-tolerant parser cannot
//   distinguish "3 empty rows" from "2 empty rows + a newline" — the 3rd
//   row is silently lost.
//
//   Fix: ALWAYS emit a trailing newline. The parser already handles it as
//   a "may or may not have" terminator, so 'A,B\n1,2\n' parses to
//   [['A','B'],['1','2']] with no phantom empty row. Round-trip now holds
//   for every input, including tables of all-empty rows.
//
// Escape rules:
//   · a field containing `,`, `"`, `\n` or `\r` is wrapped in double quotes
//   · inside the quotes, every `"` becomes `""`
//   · other fields are written literally
//
// T-13 laptop-safety: one relative type-only import. Zero npm deps.
// Source-scan test in data-analysis-v2.test.ts asserts every `from '...'`
// starts with `.` — this file must never grow an external import.

import type { Table } from './spreadsheet-v2.js';

export function writeCSV(table: Table): string {
  if (table.headers.length === 0) return '';
  const lines: string[] = [];
  lines.push(table.headers.map(escapeField).join(','));
  for (const row of table.rows) {
    lines.push(row.map(escapeField).join(','));
  }
  // Always terminate with a newline so the parser can recover a trailing
  // all-empty row. See the file header for the round-trip proof.
  const body = lines.join('\n');
  return `${body}\n`;
}

function escapeField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
// === FILE END ===