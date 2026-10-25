// packages/tools-runner/src/builtins.ts
// FR-TOOL-01: exact, deterministic arithmetic. No eval, no Function(),
// no reliance on the model.

import type { ToolExecutor } from './types.js';

export const echoExecutor: ToolExecutor<unknown, unknown> = async (input) =>
  input;

export type CalcOp = '+' | '-' | '*' | '/';

export interface CalcInput {
  op: CalcOp;
  a: number;
  b: number;
}

export const calculatorExecutor: ToolExecutor<CalcInput, number> = async (
  input,
) => {
  if (!input || typeof input !== 'object') {
    throw new Error('calculator: input must be an object');
  }
  const { op, a, b } = input;
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('calculator: a and b must be numbers');
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error('calculator: a and b must be finite');
  }
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) throw new Error('calculator: division by zero');
      return a / b;
    default:
      throw new Error(`calculator: unknown op ${String(op)}`);
  }
};

/** Ready-to-use executor map for the two built-in tools. */
export const builtinExecutors = {
  echo: echoExecutor,
  calculator: calculatorExecutor,
};