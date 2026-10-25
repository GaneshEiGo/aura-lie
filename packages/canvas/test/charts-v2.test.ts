// === FILE START ===
// packages/canvas/test/charts-v2.test.ts
// PRD §14.3 · FR-TOOL-06 · T-13.

import { describe, it, expect } from 'vitest';
import {
  renderBarChart,
  renderLineChart,
  renderSparkline,
  type ChartPoint,
} from '../src/charts-v2.js';

describe('charts — renderBarChart', () => {
  const points: ChartPoint[] = [
    { label: 'A', value: 10, claimId: 'c1' },
    { label: 'B', value: 20 },
  ];

  it('returns well-formed svg tag pair', () => {
    const svg = renderBarChart(points);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('emits one rect per point', () => {
    const svg = renderBarChart(points);
    const count = (svg.match(/<rect /g) ?? []).length;
    expect(count).toBe(2);
  });

  it('carries data-claim-id when claim present, not otherwise', () => {
    const svg = renderBarChart(points);
    expect(svg).toContain('data-claim-id="c1"');
    const rectB = svg.split('<rect ').find((s) => s.includes('B'));
    expect(rectB).toBeDefined();
    expect(rectB!).not.toContain('data-claim-id');
  });
});

describe('charts — renderLineChart', () => {
  const points: ChartPoint[] = [
    { label: 'A', value: 1, claimId: 'c1' },
    { label: 'B', value: 3 },
    { label: 'C', value: 2, claimId: 'c3' },
  ];

  it('returns well-formed svg tag pair', () => {
    const svg = renderLineChart(points);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('emits one circle per point', () => {
    const svg = renderLineChart(points);
    const count = (svg.match(/<circle /g) ?? []).length;
    expect(count).toBe(3);
  });

  it('emits a single path element', () => {
    const svg = renderLineChart(points);
    const count = (svg.match(/<path /g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('charts — renderSparkline', () => {
  it('returns well-formed svg tag pair', () => {
    const svg = renderSparkline([
      { label: '1', value: 1 },
      { label: '2', value: 2 },
    ]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('emits a single path element', () => {
    const svg = renderSparkline([
      { label: '1', value: 1 },
      { label: '2', value: 2 },
    ]);
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
  });
});

describe('charts — determinism', () => {
  it('renderBarChart same input produces identical svg twice', () => {
    const points: ChartPoint[] = [
      { label: 'A', value: 5 },
      { label: 'B', value: 9 },
    ];
    expect(renderBarChart(points)).toBe(renderBarChart(points));
  });

  it('renderLineChart same input produces identical svg twice', () => {
    const points: ChartPoint[] = [{ label: 'A', value: 1 }];
    expect(renderLineChart(points)).toBe(renderLineChart(points));
  });

  it('renderSparkline same input produces identical svg twice', () => {
    const points: ChartPoint[] = [
      { label: 'A', value: 1 },
      { label: 'B', value: 5 },
    ];
    expect(renderSparkline(points)).toBe(renderSparkline(points));
  });
});

describe('charts — source scan', () => {
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

  it('charts-v2.ts imports only relative paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'charts-v2.ts'),
      'utf8',
    );
    const external = extractSpecifiers(src).filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });

  it('charts-v2.ts is dependency-free (no imports at all)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'charts-v2.ts'),
      'utf8',
    );
    expect(extractSpecifiers(src)).toEqual([]);
  });
});
// === FILE END ===