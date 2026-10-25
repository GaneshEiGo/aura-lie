// === FILE START ===
// packages/canvas/test/terminal-skin-v2.test.ts
// PRD §6.2 · F-284.

import { describe, it, expect } from 'vitest';
import {
  TERMINAL_TOKENS,
  renderTerminalCss,
  contrastRatio,
  relativeLuminance,
} from '../src/terminal-skin-v2.js';

describe('terminal-skin — token shape', () => {
  it('contains every required token', () => {
    const required = [
      'paper', 'bone', 'ink', 'ink2', 'ink3', 'accent',
      'ok', 'warn', 'bad', 'monoFont', 'sansFont', 'pixelFont',
    ] as const;
    for (const k of required) {
      expect(TERMINAL_TOKENS[k]).toBeDefined();
      expect(typeof TERMINAL_TOKENS[k]).toBe('string');
    }
  });

  it('colour tokens are 6-digit hex', () => {
    const colours = [
      'paper', 'bone', 'ink', 'ink2', 'ink3',
      'accent', 'ok', 'warn', 'bad',
    ] as const;
    for (const k of colours) {
      expect(TERMINAL_TOKENS[k]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('token object is frozen', () => {
    expect(Object.isFrozen(TERMINAL_TOKENS)).toBe(true);
  });
});

describe('terminal-skin — PRD accent', () => {
  it('accent is exactly #7CE3A1 per PRD §6.2', () => {
    expect(TERMINAL_TOKENS.accent.toUpperCase()).toBe('#7CE3A1');
  });

  it('accent vs paper meets the PRD 12.5:1 claim within rounding', () => {
    const ratio = contrastRatio(TERMINAL_TOKENS.accent, TERMINAL_TOKENS.paper);
    // PRD states 12.5:1 — accept ±0.5 for formula rounding.
    expect(ratio).toBeGreaterThanOrEqual(12);
    expect(ratio).toBeLessThanOrEqual(13);
  });

  it('accent meets WCAG AAA (>7:1) on paper', () => {
    const ratio = contrastRatio(TERMINAL_TOKENS.accent, TERMINAL_TOKENS.paper);
    expect(ratio).toBeGreaterThan(7);
  });
});

describe('terminal-skin — renderTerminalCss', () => {
  it('emits every --terminal-* variable', () => {
    const css = renderTerminalCss();
    expect(css).toContain('--terminal-paper:');
    expect(css).toContain('--terminal-bone:');
    expect(css).toContain('--terminal-ink:');
    expect(css).toContain('--terminal-accent:');
    expect(css).toContain('--terminal-mono-font:');
    expect(css).toContain('--terminal-pixel-font:');
  });

  it('is deterministic', () => {
    expect(renderTerminalCss()).toBe(renderTerminalCss());
  });
});

describe('terminal-skin — source scan', () => {
  function extractSpecifiers(src: string): string[] {
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    return Array.from(noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g)).map(
      (m) => m[1]!,
    );
  }

  it('terminal-skin-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'terminal-skin-v2.ts'),
      'utf8',
    );
    const external = extractSpecifiers(src).filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('terminal-skin-v2.ts has zero imports at all', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'terminal-skin-v2.ts'),
      'utf8',
    );
    expect(extractSpecifiers(src)).toEqual([]);
  });
});
// === FILE END ===