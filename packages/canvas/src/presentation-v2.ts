// === FILE START ===
// packages/canvas/src/presentation-v2.ts
// PRD §14.3 · FR-CANVAS-04 · F-078 · T-13.
//
// Presentation mode: narrative → slide hierarchy → speaker notes.
// Output is Markdown. .pptx is out of scope for v1 (F-078 "pptx Later").
//
// Slide count bound to content: 1 title slide + one slide per section.
// Cap MAX_SLIDES = 30 prevents absurd decks from slipping through.
//
// No imports at all. T-13 laptop-safety. Zero npm dependency.

export type ChartSuggestion = 'none' | 'bar' | 'line' | 'pie';

export const MAX_SLIDES = 30;

export const CHART_SUGGESTIONS: readonly ChartSuggestion[] = Object.freeze([
  'none',
  'bar',
  'line',
  'pie',
] as const);

export interface SlideSection {
  heading: string;
  bullets: string[];
  notes?: string;
  chartSuggestion?: ChartSuggestion;
}

export interface Slide {
  index: number;
  title: string;
  bullets: string[];
  notes: string;
  chartSuggestion: ChartSuggestion;
}

export interface Presentation {
  title: string;
  subtitle: string;
  slides: Slide[];
  totalSlides: number;
}

export class PresentationError extends Error {
  readonly kind = 'PresentationError';
  constructor(message: string) {
    super(message);
    this.name = 'PresentationError';
  }
}

export function buildPresentation(
  title: string,
  subtitle: string,
  sections: SlideSection[],
): Presentation {
  if (sections.length === 0) {
    throw new PresentationError(
      'buildPresentation: at least one section is required',
    );
  }
  if (sections.length + 1 > MAX_SLIDES) {
    throw new PresentationError(
      `buildPresentation: ${sections.length} sections would exceed the ${MAX_SLIDES}-slide cap`,
    );
  }

  const slides: Slide[] = [];

  // Slide 1 — title slide. Its "notes" field holds the subtitle so downstream
  // export can show both without a separate type.
  slides.push({
    index: 1,
    title,
    bullets: [],
    notes: subtitle,
    chartSuggestion: 'none',
  });

  // One slide per section, in order.
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    slides.push({
      index: i + 2,
      title: s.heading,
      bullets: [...s.bullets],
      notes: s.notes ?? '',
      chartSuggestion: s.chartSuggestion ?? 'none',
    });
  }

  return {
    title,
    subtitle,
    slides,
    totalSlides: slides.length,
  };
}

export function toSlideMarkdown(p: Presentation): string {
  const blocks: string[] = [];

  blocks.push(`# ${p.title}`);
  blocks.push('');
  blocks.push(`_${p.subtitle}_`);
  blocks.push('');

  for (const s of p.slides) {
    if (s.index === 1) {
      // Title slide is already represented by the H1 above; skip.
      continue;
    }
    blocks.push(`## Slide ${s.index} — ${s.title}`);
    blocks.push('');

    if (s.bullets.length > 0) {
      for (const b of s.bullets) blocks.push(`- ${b}`);
      blocks.push('');
    }
    if (s.chartSuggestion !== 'none') {
      blocks.push(`> Chart: ${s.chartSuggestion}`);
      blocks.push('');
    }
    if (s.notes.length > 0) {
      blocks.push(`**Speaker notes:** ${s.notes}`);
      blocks.push('');
    }
  }

  return `${blocks.join('\n').trim()}\n`;
}
// === FILE END ===