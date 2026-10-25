// === FILE START ===
// packages/vision/test/sensitive-image-v2.test.ts
// PRD §14.2 · §12.3 · FR-VIS-01 · T-13.
//
// The gate MUST match the exact PRD copy (Appendix I) and MUST NOT allow
// S1 or S2 images to reach a training-risk model (Gemini).
//
// FIX HISTORY (post Section 98):
//   The "contains the phrase" test was case-sensitive, which conflicts with
//   the strict verbatim assertion (source has capital "Not"). Corrected to a
//   case-insensitive substring check — the intent is "the concept is present",
//   not "the exact capitalisation is repeated here".

import { describe, it, expect } from 'vitest';
import {
  SENSITIVE_IMAGE_COPY,
  gateImageBySensitivity,
} from '../src/sensitive-image-v2.js';

describe('sensitive-image — exact PRD copy', () => {
  it('matches the PRD Appendix I string verbatim', () => {
    expect(SENSITIVE_IMAGE_COPY).toBe(
      'Sensitive image. Not analysed, by design.',
    );
  });

  it('contains the "not analysed, by design" phrase (case-insensitive)', () => {
    expect(SENSITIVE_IMAGE_COPY.toLowerCase()).toContain(
      'not analysed, by design',
    );
  });
});

describe('sensitive-image — S0 passes', () => {
  it('S0 is allowed', () => {
    const g = gateImageBySensitivity('S0');
    expect(g.allowed).toBe(true);
    expect(g.reason).toBe('allowed');
    expect(g.copy).toBe('');
  });
});

describe('sensitive-image — S1 and S2 are blocked', () => {
  it('S1 is blocked with the PRD copy', () => {
    const g = gateImageBySensitivity('S1');
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('sensitive');
    expect(g.copy).toBe(SENSITIVE_IMAGE_COPY);
  });

  it('S2 is blocked with the PRD copy', () => {
    const g = gateImageBySensitivity('S2');
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('sensitive');
    expect(g.copy).toBe(SENSITIVE_IMAGE_COPY);
  });

  it('S1 and S2 return identical copy', () => {
    expect(gateImageBySensitivity('S1').copy).toBe(
      gateImageBySensitivity('S2').copy,
    );
  });
});

describe('sensitive-image — no leakage path', () => {
  it('the gate returns only the exact copy, no other fields', () => {
    const g = gateImageBySensitivity('S2');
    expect(Object.keys(g).sort()).toEqual(['allowed', 'copy', 'reason']);
  });
});
// === FILE END ===