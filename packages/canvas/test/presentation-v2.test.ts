// === FILE START ===
// packages/canvas/test/presentation-v2.test.ts
// PRD §14.3 · FR-CANVAS-04 · F-078 · T-13.

import { describe, it, expect } from 'vitest';
import {
  buildPresentation,
  toSlideMarkdown,
  PresentationError,
  MAX_SLIDES,
  CHART_SUGGESTIONS,
  type SlideSection,
} from '../src/presentation-v2.js';

describe('presentation — buildPresentation', () => {
  const sections: SlideSection[] = [
    { heading: 'Intro', bullets: ['one', 'two'] },
    { heading: 'Body', bullets: ['three'] },
  ];

  it('emits 1 title slide + one slide per section', () => {
    const p = buildPresentation('T', 'S', sections);
    expect(p.totalSlides).toBe(3);
    expect(p.slides.length).toBe(3);
  });

  it('slide indices start at 1 and are sequential', () => {
    const p = buildPresentation('T', 'S', sections);
    expect(p.slides.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('title slide carries the subtitle as notes', () => {
    const p = buildPresentation('My Talk', 'Q4 review', sections);
    expect(p.slides[0]!.title).toBe('My Talk');
    expect(p.slides[0]!.notes).toBe('Q4 review');
  });

  it('empty sections array throws', () => {
    expect(() => buildPresentation('T', 'S', [])).toThrow(PresentationError);
  });
});

describe('presentation — slide count bound', () => {
  it('MAX_SLIDES is a positive constant', () => {
    expect(MAX_SLIDES).toBeGreaterThan(0);
  });

  it('too many sections throws', () => {
    const sections: SlideSection[] = Array.from({ length: MAX_SLIDES }, () => ({
      heading: 'h',
      bullets: [],
    }));
    expect(() => buildPresentation('T', 'S', sections)).toThrow(PresentationError);
  });
});

describe('presentation — chart suggestions', () => {
  it('default chart suggestion is none', () => {
    const p = buildPresentation('T', 'S', [{ heading: 'a', bullets: [] }]);
    expect(p.slides[1]!.chartSuggestion).toBe('none');
  });

  it('explicit chart suggestion is preserved', () => {
    const p = buildPresentation('T', 'S', [
      { heading: 'a', bullets: [], chartSuggestion: 'bar' },
    ]);
    expect(p.slides[1]!.chartSuggestion).toBe('bar');
  });

  it('CHART_SUGGESTIONS is frozen and covers all four options', () => {
    expect(Object.isFrozen(CHART_SUGGESTIONS)).toBe(true);
    expect([...CHART_SUGGESTIONS].sort()).toEqual(['bar', 'line', 'none', 'pie']);
  });
});

describe('presentation — speaker notes', () => {
  it('section notes are preserved', () => {
    const p = buildPresentation('T', 'S', [
      { heading: 'a', bullets: ['x'], notes: 'remember the audience' },
    ]);
    expect(p.slides[1]!.notes).toBe('remember the audience');
  });

  it('missing section notes default to empty string', () => {
    const p = buildPresentation('T', 'S', [{ heading: 'a', bullets: [] }]);
    expect(p.slides[1]!.notes).toBe('');
  });
});

describe('presentation — toSlideMarkdown', () => {
  function sample() {
    return buildPresentation('Talk', 'Sub', [
      { heading: 'Intro', bullets: ['a', 'b'], notes: 'n1' },
      { heading: 'Data', bullets: ['c'], chartSuggestion: 'bar' },
    ]);
  }

  it('emits an H1 with the title', () => {
    expect(toSlideMarkdown(sample())).toMatch(/^# Talk$/m);
  });

  it('emits the subtitle as italic', () => {
    expect(toSlideMarkdown(sample())).toMatch(/^_Sub_$/m);
  });

  it('does not repeat the title slide (skips index 1)', () => {
    expect(toSlideMarkdown(sample())).not.toMatch(/Slide 1 —/);
  });

  it('emits bullets, chart suggestion, and speaker notes', () => {
    const md = toSlideMarkdown(sample());
    expect(md).toContain('- a');
    expect(md).toContain('- b');
    expect(md).toContain('> Chart: bar');
    expect(md).toContain('**Speaker notes:** n1');
  });

  it('is deterministic (same presentation → same markdown twice)', () => {
    expect(toSlideMarkdown(sample())).toBe(toSlideMarkdown(sample()));
  });
});
// === FILE END ===