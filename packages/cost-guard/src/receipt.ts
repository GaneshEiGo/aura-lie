// packages/cost-guard/src/receipt.ts
// PRD 4.7 §5 + PRD 5.10 + F-259: "This month Rs 0.00 · N replies · 0 rupees, ever."

import type { ReceiptMonth } from './types.js';

export function monthlyReceipt(input: {
  month: string;
  replies: number;
  calls: number;
}): ReceiptMonth {
  return {
    month: input.month,
    replies: input.replies,
    calls: input.calls,
    costInr: 0,
  };
}

/** The exact PRD 5.10 receipt string. */
export function renderMonthlyReceipt(receipt: ReceiptMonth): string {
  const currency = `Rs ${receipt.costInr.toFixed(2)}`;
  return `${currency} this month · ${receipt.replies} replies · 0 rupees, ever`;
}