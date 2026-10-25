// === FILE START ===
// packages/canvas/src/terminal-skin-v2.ts
// PRD §6.2 · F-284 · T-13.
//
// Terminal skin: PRD §6.2 calls it "Ink tokens with a monospace body and a
// single green accent #7CE3A1 (12.5 to 1 on Ink paper). Never the default."
//
// This module ships:
//   · TERMINAL_TOKENS — the exact token set
//   · renderTerminalCss — deterministic CSS custom-property emitter
//   · contrastRatio — WCAG 2.x contrast calculator (used by tests)
//
// No imports. Zero npm dependency. T-13 laptop-safety.

export interface TerminalTokens {
  readonly paper: string;
  readonly bone: string;
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly accent: string;
  readonly ok: string;
  readonly warn: string;
  readonly bad: string;
  readonly monoFont: string;
  readonly sansFont: string;
  readonly pixelFont: string;
}

export const TERMINAL_TOKENS: TerminalTokens = Object.freeze({
  paper: '#0B0B0C',
  bone: '#131315',
  ink: '#F2F2F3',
  ink2: '#A1A1A6',
  ink3: '#8E8E93',
  accent: '#7CE3A1',
  ok: '#5FD3A0',
  warn: '#F2C14E',
  bad: '#FF8A80',
  monoFont:
    '"JetBrains Mono", "IBM Plex Mono", "VT323", ui-monospace, monospace',
  sansFont: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  pixelFont: '"Silkscreen", ui-monospace, monospace',
});

export function renderTerminalCss(tokens: TerminalTokens = TERMINAL_TOKENS): string {
  const entries: Array<[string, string]> = [
    ['--terminal-paper', tokens.paper],
    ['--terminal-bone', tokens.bone],
    ['--terminal-ink', tokens.ink],
    ['--terminal-ink-2', tokens.ink2],
    ['--terminal-ink-3', tokens.ink3],
    ['--terminal-accent', tokens.accent],
    ['--terminal-ok', tokens.ok],
    ['--terminal-warn', tokens.warn],
    ['--terminal-bad', tokens.bad],
    ['--terminal-mono-font', tokens.monoFont],
    ['--terminal-sans-font', tokens.sansFont],
    ['--terminal-pixel-font', tokens.pixelFont],
  ];
  return entries.map(([k, v]) => `${k}: ${v};`).join('\n');
}

// -----------------------------------------------------------------------------
// WCAG 2.x relative luminance + contrast ratio
// -----------------------------------------------------------------------------

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    throw new Error(`hexToRgb: expected 6-digit hex, got "${hex}"`);
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
// === FILE END ===