// === FILE START ===
// packages/canvas/src/cell-facts-v2.ts
// PRD §14.3 · §8.12 · FR-TRUTH-19 · F-043 · T-13.
//
// Cell-level facts. Every non-empty table cell can carry a claim with its
// own source, period, and score (FR-TRUTH-19). Cells without an attached
// fact are "unverified" and surfaced by findOrphanCells so the UI can nudge
// the user honestly.
//
// No model. No fabrication. The `value` stored in the fact MUST equal the
// cell's value — annotate() validates this to prevent drift when the table
// changes and facts lag behind.
//
// One import, relative: the Table type from ./spreadsheet-v2.js.

import type { Table } from './spreadsheet-v2.js';

export interface CellFact {
  row: number;
  col: number;
  claimId: string;
  value: string;
  source: string;
  period?: string;
  score: number;
  status: string;
}

export interface AnnotatedTable extends Table {
  cellFacts: CellFact[];
}

export class CellFactError extends Error {
  readonly kind = 'CellFactError';
  constructor(message: string) {
    super(message);
    this.name = 'CellFactError';
  }
}

export function annotate(table: Table, facts: CellFact[]): AnnotatedTable {
  for (const f of facts) {
    if (f.row < 0 || f.row >= table.rows.length) {
      throw new CellFactError(
        `annotate: fact row ${f.row} is out of range (rows=${table.rows.length})`,
      );
    }
    const row = table.rows[f.row]!;
    if (f.col < 0 || f.col >= row.length) {
      throw new CellFactError(
        `annotate: fact col ${f.col} is out of range for row ${f.row} (len=${row.length})`,
      );
    }
    const cellValue = row[f.col]!;
    if (cellValue.length === 0) {
      throw new CellFactError(
        `annotate: fact points at empty cell ${f.row}:${f.col}`,
      );
    }
    if (cellValue !== f.value) {
      throw new CellFactError(
        `annotate: fact value mismatch at ${f.row}:${f.col} — fact="${f.value}" cell="${cellValue}"`,
      );
    }
  }

  return {
    headers: [...table.headers],
    rows: table.rows.map((r) => [...r]),
    cellFacts: facts.map((f) => ({ ...f })),
  };
}

export function getCellFact(
  t: AnnotatedTable,
  row: number,
  col: number,
): CellFact | null {
  return t.cellFacts.find((f) => f.row === row && f.col === col) ?? null;
}

export interface OrphanCell {
  row: number;
  col: number;
  value: string;
}

export function findOrphanCells(t: AnnotatedTable): OrphanCell[] {
  const out: OrphanCell[] = [];
  for (let r = 0; r < t.rows.length; r++) {
    const row = t.rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const value = row[c]!;
      if (value.length === 0) continue;
      const fact = getCellFact(t, r, c);
      if (fact === null) out.push({ row: r, col: c, value });
    }
  }
  return out;
}
// === FILE END ===