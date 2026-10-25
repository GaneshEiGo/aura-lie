// === FILE START ===
// packages/vision/test/preprocess-v2.test.ts
// PRD §14.2 · FR-VIS-01 · T-13.

import { describe, it, expect } from 'vitest';
import { computeResize, MAX_PIXELS } from '../src/preprocess-v2.js';

describe('computeResize — no-op when under target', () => {
  it('small image passes through unchanged', () => {
    const d = computeResize({ width: 100, height: 100 });
    expect(d.resized).toBe(false);
    expect(d.width).toBe(100);
    expect(d.height).toBe(100);
    expect(d.scale).toBe(1);
    expect(d.originalPixels).toBe(10_000);
  });

  it('exactly 1.5 MP does not trigger a resize', () => {
    const d = computeResize({ width: 1000, height: 1500 });
    expect(d.originalPixels).toBe(MAX_PIXELS);
    expect(d.resized).toBe(false);
    expect(d.scale).toBe(1);
  });

  it('never upscales', () => {
    const d = computeResize({ width: 1, height: 1 });
    expect(d.resized).toBe(false);
    expect(d.width).toBe(1);
    expect(d.height).toBe(1);
  });
});

describe('computeResize — downscales large images', () => {
  it('4 MP square → fits ~1.5 MP, aspect preserved', () => {
    const d = computeResize({ width: 2000, height: 2000 });
    expect(d.resized).toBe(true);
    expect(d.width).toBe(d.height); // square stays square
    expect(d.width * d.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(d.scale).toBeGreaterThan(0);
    expect(d.scale).toBeLessThan(1);
  });

  it('3 MP wide aspect 3:1 is preserved', () => {
    const d = computeResize({ width: 3000, height: 1000 });
    expect(d.resized).toBe(true);
    const ratio = d.width / d.height;
    expect(Math.abs(ratio - 3)).toBeLessThan(0.05);
    expect(d.width * d.height).toBeLessThanOrEqual(MAX_PIXELS);
  });

  it('originalPixels is preserved in the decision', () => {
    const d = computeResize({ width: 2000, height: 2000 });
    expect(d.originalPixels).toBe(4_000_000);
    expect(d.targetPixels).toBe(MAX_PIXELS);
  });

  it('custom maxPixels is honoured', () => {
    const d = computeResize({ width: 1000, height: 1000 }, 100_000);
    expect(d.resized).toBe(true);
    expect(d.width * d.height).toBeLessThanOrEqual(100_000);
    expect(d.targetPixels).toBe(100_000);
  });
});

describe('computeResize — invalid input', () => {
  it('throws on NaN width', () => {
    expect(() => computeResize({ width: NaN, height: 100 })).toThrow();
  });

  it('throws on Infinity', () => {
    expect(() => computeResize({ width: Infinity, height: 100 })).toThrow();
  });

  it('throws on zero width', () => {
    expect(() => computeResize({ width: 0, height: 100 })).toThrow();
  });

  it('throws on negative height', () => {
    expect(() => computeResize({ width: 100, height: -1 })).toThrow();
  });

  it('throws on non-positive maxPixels', () => {
    expect(() => computeResize({ width: 100, height: 100 }, 0)).toThrow();
  });
});
// === FILE END ===