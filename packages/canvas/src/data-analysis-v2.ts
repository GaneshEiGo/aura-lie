// === FILE START ===
// packages/canvas/src/data-analysis-v2.ts
// PRD §14.5 · FR-TOOL-06 · F-185 · T-13.
//
// Data analysis: CSV/XLSX → clean table → summary. Charts are out of scope.
//
// PRD §9.10: "Numbers come from counters, not from the model." The summary
// is entirely deterministic — it reports real counts (rows, columns,
// numeric-column count) and never fabricates.
//
// Column classification:
//   · 'empty'   — 0 non-empty cells
//   · 'numeric' — every non-empty cell parses as a finite number
//   · 'text'    — 0 non-empty cells parse as a finite number
//   · 'mixed'   — some do, some do not
//
// For numeric columns we report min, max, mean, sum. For every other kind,
// those four fields are null. This makes the honest limitation visible: the
// module never invents a "mean" for a text column.
//
// No model call. Zero external imports. T-13 laptop-safety. The only import
// is a type-only relative import from ./spreadsheet-v2.js.

import type { Table } from './spreadsheet-v2.js';

export type ColumnKind = 'empty' | 'numeric' | 'text' | 'mixed';

export interface ColumnStats {
  name: string;
  index: number;
  kind: ColumnKind;
  nonEmptyCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  sum: number | null;
}

export interface Analysis {
  rows: number;
  columns: number;
  numericColumnCount: number;
  columnStats: ColumnStats[];
  /** Deterministic, count-based; never fabricated. */
  summary: string;
}

export function analyzeTable(table: Table): Analysis {
  const columns = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    0,
  );

  const columnStats: ColumnStats[] = [];
  for (let c = 0; c < columns; c++) {
    const name = table.headers[c] ?? `Column ${c + 1}`;
    const values: string[] = [];
    for (const row of table.rows) {
      const raw = row[c];
      if (raw === undefined) continue;
      const trimmed = raw.trim();
      if (trimmed.length > 0) values.push(trimmed);
    }

    if (values.length === 0) {
      columnStats.push({
        name,
        index: c,
        kind: 'empty',
        nonEmptyCount: 0,
        min: null,
        max: null,
        mean: null,
        sum: null,
      });
      continue;
    }

    const nums: number[] = [];
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n)) nums.push(n);
    }

    if (nums.length === 0) {
      columnStats.push({
        name,
        index: c,
        kind: 'text',
        nonEmptyCount: values.length,
        min: null,
        max: null,
        mean: null,
        sum: null,
      });
      continue;
    }

    if (nums.length < values.length) {
      columnStats.push({
        name,
        index: c,
        kind: 'mixed',
        nonEmptyCount: values.length,
        min: null,
        max: null,
        mean: null,
        sum: null,
      });
      continue;
    }

    let min = nums[0]!;
    let max = nums[0]!;
    let sum = 0;
    for (const n of nums) {
      if (n < min) min = n;
      if (n > max) max = n;
      sum += n;
    }
    columnStats.push({
      name,
      index: c,
      kind: 'numeric',
      nonEmptyCount: nums.length,
      min,
      max,
      mean: sum / nums.length,
      sum,
    });
  }

  const numericColumnCount = columnStats.filter((s) => s.kind === 'numeric').length;
  const rowWord = table.rows.length === 1 ? 'row' : 'rows';
  const colWord = columns === 1 ? 'column' : 'columns';
  const numWord = numericColumnCount === 1 ? 'column' : 'columns';
  const summary = `${table.rows.length} ${rowWord}, ${columns} ${colWord}. ${numericColumnCount} numeric ${numWord}.`;

  return {
    rows: table.rows.length,
    columns,
    numericColumnCount,
    columnStats,
    summary,
  };
}
// === FILE END ===