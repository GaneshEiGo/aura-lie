/**
 * Safe Calculator.
 * Evaluates basic math (+ - * /) WITHOUT using eval() or Function().
 * Enforces Law L2: Zero Local Compute risks.
 */
export function safeCalculate(expression: string): number | null {
  // 1. Sanitize: only allow numbers, spaces, and basic operators
  if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expression)) return null;

  // 2. Tokenize
  const tokens = expression.match(/(\d+\.?\d*|[\+\-\*\/\(\)])/g);
  if (!tokens) return null;

  // 3. Shunting-yard algorithm to build Reverse Polish Notation (RPN)
  const outputQueue: string[] = [];
  const operatorStack: string[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

  for (const token of tokens) {
    if (/\d/.test(token)) {
      outputQueue.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.pop(); // Remove '('
    } else {
      while (
        operatorStack.length > 0 &&
        precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    }
  }

  while (operatorStack.length > 0) {
    outputQueue.push(operatorStack.pop()!);
  }

  // 4. Evaluate RPN
  const evalStack: number[] = [];
  for (const token of outputQueue) {
    if (/\d/.test(token)) {
      evalStack.push(parseFloat(token));
    } else {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) return null;
      switch (token) {
        case '+': evalStack.push(a + b); break;
        case '-': evalStack.push(a - b); break;
        case '*': evalStack.push(a * b); break;
        case '/': 
          if (b === 0) return null;
          evalStack.push(a / b); 
          break;
      }
    }
  }

  return evalStack.length === 1 ? evalStack[0] : null;
}

export function parseDateMath(query: string): string | null {
  const lower = query.toLowerCase();
  
  // "What is the date 3 days from now?"
  const daysMatch = lower.match(/(\d+)\s+days?\s+from\s+now/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `The date ${days} days from now is ${d.toISOString().split('T')[0]}.`;
  }

  // "What is the date tomorrow?"
  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `Tomorrow is ${d.toISOString().split('T')[0]}.`;
  }

  return null;
}