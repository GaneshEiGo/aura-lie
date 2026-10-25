// === FILE START ===
// packages/personas/test/mixing-v2.test.ts
// PRD §11.4 · FR-PERS-03.

import { describe, it, expect } from 'vitest';
import { mixPersonas, mixSliders } from '../src/personas-mixing-v2.js';
import {
  SLIDER_KEYS,
  AURA_LIE,
  YUKI,
  RIN,
} from '../src/personas-roster-v2.js';

describe('mixing — convex combination', () => {
  it('50/50 of two personas produces the mean of each slider', () => {
    const out = mixPersonas({
      personas: [AURA_LIE, YUKI],
      weights: [0.5, 0.5],
    });
    for (const k of SLIDER_KEYS) {
      expect(out.sliders[k]).toBeCloseTo(
        (AURA_LIE.sliders[k] + YUKI.sliders[k]) / 2,
        5,
      );
    }
  });

  it('100/0 is equivalent to the dominant persona', () => {
    const out = mixSliders([AURA_LIE.sliders, YUKI.sliders], [1, 0]);
    for (const k of SLIDER_KEYS) {
      expect(out[k]).toBeCloseTo(AURA_LIE.sliders[k], 5);
    }
  });

  it('mixing preserves rules and banned as a union', () => {
    const out = mixPersonas({
      personas: [AURA_LIE, YUKI],
      weights: [0.5, 0.5],
    });
    expect(out.rules.length).toBeGreaterThanOrEqual(AURA_LIE.rules.length);
    expect(out.banned.length).toBeGreaterThan(0);
    for (const b of AURA_LIE.banned) {
      expect(out.banned).toContain(b);
    }
  });

  it('mixed_from and weights are recorded', () => {
    const out = mixPersonas({
      personas: [AURA_LIE, YUKI, RIN],
      weights: [0.4, 0.3, 0.3],
    });
    expect(out.mixed_from).toEqual(['aura-lie', 'yuki', 'rin']);
    expect(out.weights).toEqual([0.4, 0.3, 0.3]);
  });
});

describe('mixing — boundaries and validation', () => {
  it('rejects a single persona', () => {
    expect(() =>
      mixPersonas({ personas: [AURA_LIE], weights: [1] }),
    ).toThrow();
  });

  it('rejects weights not summing to 1', () => {
    expect(() =>
      mixPersonas({ personas: [AURA_LIE, YUKI], weights: [0.4, 0.4] }),
    ).toThrow();
  });

  it('rejects zero or negative weight', () => {
    expect(() =>
      mixPersonas({ personas: [AURA_LIE, YUKI], weights: [0, 1] }),
    ).toThrow();
    expect(() =>
      mixPersonas({ personas: [AURA_LIE, YUKI], weights: [-0.1, 1.1] }),
    ).toThrow();
  });
});
// === FILE END ===