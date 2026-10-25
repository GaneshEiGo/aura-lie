// === FILE START ===
// packages/canvas/test/code-reviewer-v2.test.ts
// PRD §14.5 · F-197 · T-13.

import { describe, it, expect } from 'vitest';
import { reviewCode } from '../src/code-reviewer-v2.js';

describe('code-reviewer — no findings on clean code', () => {
  it('empty source → no findings', () => {
    const r = reviewCode('');
    expect(r.findings).toEqual([]);
    expect(r.count).toEqual({ bug: 0, style: 0, security: 0, tests: 0 });
  });
});

describe('code-reviewer — security patterns', () => {
  it('detects eval()', () => {
    const r = reviewCode('const x = eval("1+1");');
    const f = r.findings.find((x) => x.category === 'security');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects new Function()', () => {
    const r = reviewCode('const fn = new Function("return 1");');
    expect(r.count.security).toBeGreaterThanOrEqual(1);
  });

  it('detects innerHTML assignment', () => {
    const r = reviewCode('el.innerHTML = "<b>x</b>";');
    const f = r.findings.find((x) => x.category === 'security');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('detects insecure http:// URL', () => {
    const r = reviewCode('const url = "http://example.com";');
    expect(r.count.security).toBe(1);
  });
});

describe('code-reviewer — bug patterns', () => {
  it('detects var declarations', () => {
    const r = reviewCode('var x = 1;');
    expect(r.count.bug).toBe(1);
    expect(r.findings[0]!.message).toMatch(/let\/const/);
  });

  it('detects loose equality ==', () => {
    const r = reviewCode('if (a == b) {}');
    expect(r.count.bug).toBe(1);
  });

  it('does not flag strict equality ===', () => {
    const r = reviewCode('if (a === b) {}');
    expect(r.count.bug).toBe(0);
  });
});

describe('code-reviewer — style patterns', () => {
  it('detects console.log', () => {
    const r = reviewCode('console.log("x");');
    expect(r.count.style).toBe(1);
  });

  it('detects debugger', () => {
    const r = reviewCode('debugger;');
    const f = r.findings.find((x) => x.category === 'style');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('detects TODO comments', () => {
    const r = reviewCode('// TODO fix this');
    expect(r.count.style).toBe(1);
  });
});

describe('code-reviewer — findings carry line numbers and tests heuristic', () => {
  it('each finding carries the source line number', () => {
    const src = 'const a = 1;\nconsole.log(a);\nvar b = 2;';
    const r = reviewCode(src);
    const byLine = new Map(r.findings.map((f) => [f.message, f.line]));
    expect(byLine.get('console.log left in code.')).toBe(2);
    expect(byLine.get('Prefer let/const over var.')).toBe(3);
  });

  it('reports a tests finding when no test block exists', () => {
    const r = reviewCode('const x = 1;');
    expect(r.count.tests).toBe(1);
    expect(r.findings.find((f) => f.category === 'tests')).toBeDefined();
  });

  it('does not report a tests finding when describe( is present', () => {
    const r = reviewCode('describe("x", () => {});');
    expect(r.count.tests).toBe(0);
  });

  it('is deterministic (identical findings array twice)', () => {
    const src = 'var x = 1;\nconsole.log(x);\nif (a == b) {}';
    const a = reviewCode(src);
    const b = reviewCode(src);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
// === FILE END ===