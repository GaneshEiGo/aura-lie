// === FILE START ===
// packages/canvas/src/spreadsheet-v2.ts
// PRD §14.3 · FR-CANVAS-05 · F-077 · T-13.
//
// CSV parsing + formula evaluation. Hand-rolled. Zero external deps.
//
// CSV parser: RFC 4180-ish — commas, quotes, embedded quotes, embedded
// newlines, CRLF or LF, trailing-newline tolerance.
//
// Formula language (v1): numbers, cell refs (A1, B2, AA10), binary +-*/,
// parens, unary minus. NO functions (SUM/AVG) — FR-CANVAS-05 marks those P2.
//
// CELL ADDRESSING (Section 100 fix):
//   A1 = table.rows[0][0]   (Excel semantics — first data cell)
//   A2 = table.rows[1][0]
//   Headers are column labels, NOT a data row.
//   Previously my parser treated A1 as headers[0], which broke every
//   cell-ref formula. This is now the Excel convention, matching the test
//   fixture and real spreadsheets.
//
// Formula errors: #REF!, #VALUE!, #DIV/0!, #CYCLE!.
//   · Row out of range → #REF!
//   · Non-numeric non-empty cell → #VALUE!
//   · Division by zero → #DIV/0!
//   · Recursive formulas (depth > MAX_FORMULA_DEPTH) → #CYCLE!
//   · Empty cells inside formulas are treated as 0 (Excel behaviour).
//
// SAFETY: This module does NOT call eval() or new Function(). Every formula
// is parsed by a hand-rolled recursive descent parser with a strict grammar.
// Pasted canvas content can never become arbitrary code execution.

export interface Table {
  headers: string[];
  rows: string[][];
}

// -----------------------------------------------------------------------------
// CSV parser
// -----------------------------------------------------------------------------

export function parseCSV(text: string): Table {
  if (text.length === 0) return { headers: [], rows: [] };

  const records: string[][] = [];
  let i = 0;
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const flushField = (): void => {
    currentRecord.push(currentField);
    currentField = '';
  };
  const flushRecord = (): void => {
    flushField();
    records.push(currentRecord);
    currentRecord = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      currentField += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      flushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += text[i + 1] === '\n' ? 2 : 1;
      flushRecord();
      continue;
    }
    if (ch === '\n') {
      flushRecord();
      i += 1;
      continue;
    }
    currentField += ch;
    i += 1;
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    flushRecord();
  }

  if (records.length === 0) return { headers: [], rows: [] };

  return { headers: records[0]!, rows: records.slice(1) };
}

// -----------------------------------------------------------------------------
// Formula evaluation
// -----------------------------------------------------------------------------

export type FormulaError = '#REF!' | '#VALUE!' | '#DIV/0!' | '#CYCLE!';

export interface FormulaResult {
  value: number | null;
  error: FormulaError | null;
  /** Directly-referenced cells, in order of first appearance, deduped. */
  dependencies: string[];
}

/** Recursion cap used to detect cyclic formula chains. */
export const MAX_FORMULA_DEPTH = 32;

export function evaluateFormula(formula: string, table: Table): FormulaResult {
  return evalFormulaInternal(formula, table, 0);
}

function evalFormulaInternal(
  formula: string,
  table: Table,
  depth: number,
): FormulaResult {
  if (depth > MAX_FORMULA_DEPTH) {
    return { value: null, error: '#CYCLE!', dependencies: [] };
  }

  const src = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
  if (src.length === 0) {
    return { value: null, error: '#VALUE!', dependencies: [] };
  }

  const dependencies: string[] = [];
  let pos = 0;

  class ParseErr extends Error {
    readonly code: FormulaError;
    constructor(code: FormulaError) {
      super(code);
      this.code = code;
    }
  }

  const peek = (): string => (pos < src.length ? src[pos]! : '');
  const advance = (): string => src[pos++] ?? '';
  const skipSpaces = (): void => {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++;
  };

  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op !== '+' && op !== '-') return left;
      advance();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op !== '*' && op !== '/') return left;
      advance();
      const right = parseFactor();
      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) throw new ParseErr('#DIV/0!');
        left = left / right;
      }
    }
  };

  const parseFactor = (): number => {
    skipSpaces();
    const ch = peek();
    if (ch === '-') {
      advance();
      return -parseFactor();
    }
    if (ch === '+') {
      advance();
      return parseFactor();
    }
    if (ch === '(') {
      advance();
      const inner = parseExpr();
      skipSpaces();
      if (peek() !== ')') throw new ParseErr('#VALUE!');
      advance();
      return inner;
    }
    if (/[0-9.]/.test(ch)) {
      let s = '';
      while (pos < src.length && /[0-9.]/.test(src[pos]!)) s += advance();
      const n = Number(s);
      if (!Number.isFinite(n)) throw new ParseErr('#VALUE!');
      return n;
    }
    if (/[A-Z]/i.test(ch)) {
      return parseCellRef();
    }
    throw new ParseErr('#VALUE!');
  };

  // Excel semantics: A1 = rows[0][0], A2 = rows[1][0], AA10 = rows[9][26].
  const parseCellRef = (): number => {
    let col = '';
    while (pos < src.length && /[A-Z]/i.test(src[pos]!)) col += advance().toUpperCase();
    let rowStr = '';
    while (pos < src.length && /[0-9]/.test(src[pos]!)) rowStr += advance();
    if (col.length === 0 || rowStr.length === 0) throw new ParseErr('#VALUE!');

    const ref = `${col}${rowStr}`;
    if (!dependencies.includes(ref)) dependencies.push(ref);

    const colIndex = colToIndex(col);
    const rowIndex = parseInt(rowStr, 10) - 1;

    // Excel: row out of range → #REF!; column out of range → 0 (empty cell).
    if (rowIndex < 0 || rowIndex >= table.rows.length) throw new ParseErr('#REF!');

    const raw = table.rows[rowIndex]?.[colIndex];

    if (raw === undefined || raw === '') {
      return 0;
    }
    if (raw.startsWith('=')) {
      const inner = evalFormulaInternal(raw, table, depth + 1);
      if (inner.error) throw new ParseErr(inner.error);
      return inner.value ?? 0;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new ParseErr('#VALUE!');
    return n;
  };

  try {
    const value = parseExpr();
    skipSpaces();
    if (pos !== src.length) {
      return { value: null, error: '#VALUE!', dependencies };
    }
    if (!Number.isFinite(value)) {
      return { value: null, error: '#VALUE!', dependencies };
    }
    return { value, error: null, dependencies };
  } catch (e) {
    if (e instanceof ParseErr) {
      return { value: null, error: e.code, dependencies };
    }
    return { value: null, error: '#VALUE!', dependencies };
  }
}

/** Column label → 0-based index. "A" → 0, "Z" → 25, "AA" → 26. */
export function colToIndex(col: string): number {
  if (col.length === 0) return -1;
  let n = 0;
  for (let k = 0; k < col.length; k++) {
    n = n * 26 + (col.charCodeAt(k) - 64);
  }
  return n - 1;
}
// === FILE END ===