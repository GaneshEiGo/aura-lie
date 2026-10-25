// === FILE START ===
// packages/canvas/src/code-reviewer-v2.ts
// PRD §14.5 · F-197 · T-13.
//
// Pattern-based code reviewer. Bugs / style / security / tests. Findings
// carry the source line number. Zero execution — this module never runs the
// reviewed code. Zero external imports.
//
// PRD §14.5: "Code reviewer: bugs, style, security notes. Does not run code."
// The findings are deterministic: same input → same findings array in the
// same order.

export type FindingCategory = 'bug' | 'style' | 'security' | 'tests';
export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  line: number;
  category: FindingCategory;
  severity: FindingSeverity;
  message: string;
}

export interface ReviewCounts {
  bug: number;
  style: number;
  security: number;
  tests: number;
}

export interface ReviewResult {
  findings: Finding[];
  count: ReviewCounts;
}

interface PatternRule {
  pattern: RegExp;
  category: FindingCategory;
  severity: FindingSeverity;
  message: string;
}

const PATTERNS: readonly PatternRule[] = Object.freeze([
  // Security
  {
    pattern: /\beval\s*\(/,
    category: 'security',
    severity: 'error',
    message: 'Uses eval() — arbitrary code execution risk.',
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    category: 'security',
    severity: 'error',
    message: 'Uses new Function() — arbitrary code execution risk.',
  },
  {
    pattern: /\.innerHTML\s*=/,
    category: 'security',
    severity: 'warning',
    message: 'Assigns to innerHTML — XSS risk. Use textContent.',
  },
  {
    pattern: /\bdangerouslySetInnerHTML\b/,
    category: 'security',
    severity: 'warning',
    message: 'dangerouslySetInnerHTML — XSS risk.',
  },
  {
    pattern: /(?:^|[^s])\bhttp:\/\//,
    category: 'security',
    severity: 'warning',
    message: 'Insecure http:// URL.',
  },
  // Bugs
  {
    pattern: /(?:^|[^.A-Za-z])\bvar\s+/,
    category: 'bug',
    severity: 'warning',
    message: 'Prefer let/const over var.',
  },
  {
    pattern: /[^=!<>]==(?!=)/,
    category: 'bug',
    severity: 'info',
    message: 'Loose equality; prefer ===.',
  },
  {
    pattern: /[^!<>]!=(?!=)/,
    category: 'bug',
    severity: 'info',
    message: 'Loose inequality; prefer !==.',
  },
  // Style
  {
    pattern: /\bconsole\.log\b/,
    category: 'style',
    severity: 'info',
    message: 'console.log left in code.',
  },
  {
    pattern: /\bdebugger\b/,
    category: 'style',
    severity: 'warning',
    message: 'debugger statement left in code.',
  },
  {
    pattern: /\bTODO\b/,
    category: 'style',
    severity: 'info',
    message: 'TODO left in code.',
  },
]);

export function reviewCode(source: string): ReviewResult {
  if (typeof source !== 'string') source = '';
  const lines = source.split(/\r?\n/);
  const findings: Finding[] = [];
  const count: ReviewCounts = { bug: 0, style: 0, security: 0, tests: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const p of PATTERNS) {
      if (p.pattern.test(line)) {
        findings.push({
          line: i + 1,
          category: p.category,
          severity: p.severity,
          message: p.message,
        });
        count[p.category] += 1;
      }
    }
  }

  // Tests heuristic — presence of a test block anywhere.
  if (source.trim().length > 0 && !/\b(?:describe|it|test)\s*\(/.test(source)) {
    findings.push({
      line: 0,
      category: 'tests',
      severity: 'info',
      message: 'No test block found.',
    });
    count.tests += 1;
  }

  return { findings, count };
}
// === FILE END ===