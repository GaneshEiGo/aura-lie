// === FILE START ===
// packages/canvas/src/charts-v2.ts
// PRD §14.3 · FR-TOOL-06 · T-13.
//
// Lightweight SVG chart primitives. Hand-rolled SVG strings, zero npm —
// no chart.js, no d3, no recharts. Every data mark carries `data-claim-id`
// when a claim is present (FR-TRUTH-19): hovering a bar or point shows the
// claim behind it.
//
// Deterministic output: same input produces identical SVG strings, so the
// replay test can compare them character-for-character.
//
// No imports at all. T-13 laptop-safety.

export interface ChartPoint {
  label: string;
  value: number;
  claimId?: string;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  title?: string;
}

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 200;
const PADDING = 24;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function header(opts: ChartOptions): { w: number; h: number; title: string } {
  return {
    w: opts.width ?? DEFAULT_WIDTH,
    h: opts.height ?? DEFAULT_HEIGHT,
    title: opts.title ?? '',
  };
}

function computeExtents(points: ChartPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 1 };
  let min = points[0]!.value;
  let max = points[0]!.value;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (min === max) {
    min = Math.min(0, min);
    max = max === 0 ? 1 : max;
  }
  return { min, max };
}

export function renderBarChart(
  points: ChartPoint[],
  opts: ChartOptions = {},
): string {
  const { w, h, title } = header(opts);
  const innerW = w - 2 * PADDING;
  const innerH = h - 2 * PADDING;
  const { min, max } = computeExtents(points);
  const span = max - min;
  const barWidth = points.length === 0 ? 0 : innerW / points.length;

  const bars = points.map((p, i) => {
    const normalized = (p.value - min) / span;
    const barH = Math.max(0, Math.round(normalized * innerH));
    const x = PADDING + Math.round(i * barWidth);
    const y = PADDING + (innerH - barH);
    const claim = p.claimId ? ` data-claim-id="${escapeXml(p.claimId)}"` : '';
    const width = Math.max(1, Math.floor(barWidth) - 1);
    return `<rect x="${x}" y="${y}" width="${width}" height="${barH}" fill="#1F4EFF"${claim}><title>${escapeXml(p.label)}: ${p.value}</title></rect>`;
  });

  const svgTitle = title
    ? `<text x="${w / 2}" y="14" text-anchor="middle" font-size="11">${escapeXml(title)}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    svgTitle,
    bars.join(''),
    '</svg>',
  ].join('');
}

export function renderLineChart(
  points: ChartPoint[],
  opts: ChartOptions = {},
): string {
  const { w, h, title } = header(opts);
  const innerW = w - 2 * PADDING;
  const innerH = h - 2 * PADDING;
  const { min, max } = computeExtents(points);
  const span = max - min;
  const stepX = points.length <= 1 ? 0 : innerW / (points.length - 1);

  const pathParts: string[] = [];
  const dots: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const normalized = (p.value - min) / span;
    const x = PADDING + Math.round(i * stepX);
    const y = PADDING + Math.round(innerH - normalized * innerH);
    pathParts.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
    const claim = p.claimId ? ` data-claim-id="${escapeXml(p.claimId)}"` : '';
    dots.push(
      `<circle cx="${x}" cy="${y}" r="3" fill="#1F4EFF"${claim}><title>${escapeXml(p.label)}: ${p.value}</title></circle>`,
    );
  }

  const svgTitle = title
    ? `<text x="${w / 2}" y="14" text-anchor="middle" font-size="11">${escapeXml(title)}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    svgTitle,
    `<path d="${pathParts.join(' ')}" fill="none" stroke="#1F4EFF" stroke-width="2"/>`,
    dots.join(''),
    '</svg>',
  ].join('');
}

export function renderSparkline(
  points: ChartPoint[],
  opts: ChartOptions = {},
): string {
  const w = opts.width ?? 120;
  const h = opts.height ?? 24;
  const innerH = h - 4;
  const innerW = w - 4;
  const { min, max } = computeExtents(points);
  const span = max - min;
  const stepX = points.length <= 1 ? 0 : innerW / (points.length - 1);

  const parts: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const normalized = (p.value - min) / span;
    const x = 2 + Math.round(i * stepX);
    const y = 2 + Math.round(innerH - normalized * innerH);
    parts.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${parts.join(' ')}" fill="none" stroke="#1F4EFF" stroke-width="1.5"/></svg>`;
}
// === FILE END ===