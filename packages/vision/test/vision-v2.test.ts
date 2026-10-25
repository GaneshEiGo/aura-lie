// === FILE START ===
// packages/vision/test/vision-v2.test.ts
// PRD §14.2 · FR-VIS-01 · FR-VIS-02 · FR-VIS-03 · T-13.
//
// FIX HISTORY (post Section 98):
//   The T-13 source scan matched words in doc-comments (e.g. a comment that
//   says "we do not use transformers.js") and failed even though the file
//   imports zero model runtimes. Corrected: strip both block and line
//   comments before scanning, so the gate checks actual code, not prose.

import { describe, it, expect } from 'vitest';
import {
  describeImage,
  ocrImage,
  critiqueUI,
  compareImages,
  createQuotaTracker,
  DEFAULT_DAILY_VISION_LIMIT,
  type VisionCaller,
  type VisionInput,
  type VisionCallResponse,
  type VisionCallRequest,
} from '../src/vision-v2.js';
import { MAX_PIXELS } from '../src/preprocess-v2.js';
import { SENSITIVE_IMAGE_COPY } from '../src/sensitive-image-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function tinyImage(bytes: number[] = [1, 2, 3]) {
  return { bytes: new Uint8Array(bytes), width: 100, height: 100, mimeType: 'image/png' };
}

function s0Input(): VisionInput {
  return { sensitivity: 'S0', image: tinyImage() };
}

function stubCaller(response: VisionCallResponse = { text: 'a cat' }): {
  caller: VisionCaller;
  calls: VisionCallRequest[];
} {
  const calls: VisionCallRequest[] = [];
  const caller: VisionCaller = async (req) => {
    calls.push(req);
    return response;
  };
  return { caller, calls };
}

// =============================================================================
// 1. Happy path for describeImage
// =============================================================================

describe('vision — describeImage', () => {
  it('returns text from the caller', async () => {
    const { caller } = stubCaller({ text: 'A photo of a cat.' });
    const r = await describeImage(s0Input(), {
      caller,
      quota: createQuotaTracker(50),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('A photo of a cat.');
  });

  it('passes resize decision in the result', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      {
        sensitivity: 'S0',
        image: { bytes: new Uint8Array([1]), width: 4000, height: 4000, mimeType: 'image/jpeg' },
      },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resized.resized).toBe(true);
      expect(r.resized.width * r.resized.height).toBeLessThanOrEqual(MAX_PIXELS);
    }
  });

  it('small image reports resized=false', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(s0Input(), {
      caller,
      quota: createQuotaTracker(50),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resized.resized).toBe(false);
  });
});

// =============================================================================
// 2. Sensitivity short-circuit (FR-VIS-01)
// =============================================================================

describe('vision — S1/S2 short-circuit (FR-VIS-01)', () => {
  it('S1 does NOT call the caller', async () => {
    let called = false;
    const spy: VisionCaller = async () => {
      called = true;
      return { text: '' };
    };
    const r = await describeImage(
      { sensitivity: 'S1', image: tinyImage() },
      { caller: spy, quota: createQuotaTracker(50) },
    );
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('sensitive');
      expect(r.copy).toBe(SENSITIVE_IMAGE_COPY);
    }
  });

  it('S2 does NOT call the caller', async () => {
    let called = false;
    const spy: VisionCaller = async () => {
      called = true;
      return { text: '' };
    };
    const r = await describeImage(
      { sensitivity: 'S2', image: tinyImage() },
      { caller: spy, quota: createQuotaTracker(50) },
    );
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('S2 returns the exact PRD copy', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      { sensitivity: 'S2', image: tinyImage() },
      { caller, quota: createQuotaTracker(50) },
    );
    if (!r.ok) expect(r.copy).toBe('Sensitive image. Not analysed, by design.');
  });

  it('S1/S2 do not consume quota', async () => {
    const { caller } = stubCaller();
    const quota = createQuotaTracker(50);
    const r = await describeImage(
      { sensitivity: 'S2', image: tinyImage() },
      { caller, quota },
    );
    expect(r.ok).toBe(false);
    expect(quota.used()).toBe(0);
  });
});

// =============================================================================
// 3. Quota (FR-VIS-01: 50 images/day)
// =============================================================================

describe('vision — daily quota', () => {
  it('DEFAULT_DAILY_VISION_LIMIT is 50', () => {
    expect(DEFAULT_DAILY_VISION_LIMIT).toBe(50);
  });

  it('50th call succeeds, 51st returns quota-exhausted', async () => {
    const { caller } = stubCaller();
    const quota = createQuotaTracker(50);
    for (let i = 0; i < 50; i++) {
      const r = await describeImage(s0Input(), { caller, quota });
      expect(r.ok).toBe(true);
    }
    expect(quota.used()).toBe(50);
    expect(quota.remaining()).toBe(0);
    const r51 = await describeImage(s0Input(), { caller, quota });
    expect(r51.ok).toBe(false);
    if (!r51.ok) expect(r51.reason).toBe('quota-exhausted');
  });

  it('fresh quota resets the counter', async () => {
    const { caller } = stubCaller();
    const q1 = createQuotaTracker(1);
    const q2 = createQuotaTracker(1);
    await describeImage(s0Input(), { caller, quota: q1 });
    const r1 = await describeImage(s0Input(), { caller, quota: q1 });
    expect(r1.ok).toBe(false);
    const r2 = await describeImage(s0Input(), { caller, quota: q2 });
    expect(r2.ok).toBe(true);
  });

  it('successful call reports quotaRemaining', async () => {
    const { caller } = stubCaller();
    const quota = createQuotaTracker(3);
    const r = await describeImage(s0Input(), { caller, quota });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quotaRemaining).toBe(2);
  });
});

// =============================================================================
// 4. No caller, no input, no dims
// =============================================================================

describe('vision — failure paths', () => {
  it('null caller → no-caller', async () => {
    const r = await describeImage(s0Input(), {
      caller: null,
      quota: createQuotaTracker(50),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-caller');
  });

  it('empty bytes → invalid-input', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      {
        sensitivity: 'S0',
        image: { bytes: new Uint8Array(0), width: 100, height: 100, mimeType: 'image/png' },
      },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-input');
  });

  it('zero width → invalid-input', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      {
        sensitivity: 'S0',
        image: { bytes: new Uint8Array([1]), width: 0, height: 100, mimeType: 'image/png' },
      },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-input');
  });

  it('NaN dims → invalid-input', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      {
        sensitivity: 'S0',
        image: { bytes: new Uint8Array([1]), width: NaN, height: 100, mimeType: 'image/png' },
      },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-input');
  });

  it('invalid input does not consume quota', async () => {
    const { caller } = stubCaller();
    const quota = createQuotaTracker(50);
    await describeImage(
      {
        sensitivity: 'S0',
        image: { bytes: new Uint8Array(0), width: 100, height: 100, mimeType: 'image/png' },
      },
      { caller, quota },
    );
    expect(quota.used()).toBe(0);
  });
});

// =============================================================================
// 5. OCR, critique, compare
// =============================================================================

describe('vision — ocrImage', () => {
  it('returns OCR text from the caller', async () => {
    const { caller, calls } = stubCaller({ text: 'Hello, world.' });
    const r = await ocrImage(s0Input(), { caller, quota: createQuotaTracker(50) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('Hello, world.');
    expect(calls[0]!.capability).toBe('ocr');
  });
});

describe('vision — critiqueUI', () => {
  it('preserves region citations from the caller (FR-VIS-02)', async () => {
    const caller: VisionCaller = async () => ({
      text: 'Contrast is too low on the Save button.',
      regions: [
        { label: 'Save button', bbox: { x: 0.1, y: 0.2, w: 0.15, h: 0.06 } },
      ],
    });
    const r = await critiqueUI(s0Input(), {
      caller,
      quota: createQuotaTracker(50),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.regions?.length).toBe(1);
      expect(r.regions?.[0]?.label).toBe('Save button');
      expect(r.regions?.[0]?.bbox.x).toBe(0.1);
    }
  });
});

describe('vision — compareImages', () => {
  it('missing second image → invalid-input', async () => {
    const { caller } = stubCaller();
    const r = await compareImages(
      { sensitivity: 'S0', image: tinyImage() },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-input');
  });

  it('two images → caller receives both', async () => {
    const { caller, calls } = stubCaller({
      text: 'The only difference is the header.',
    });
    const input: VisionInput = {
      sensitivity: 'S0',
      image: tinyImage([1, 2, 3]),
      secondImage: {
        bytes: new Uint8Array([4, 5, 6]),
        width: 100,
        height: 100,
        mimeType: 'image/png',
      },
    };
    const r = await compareImages(input, {
      caller,
      quota: createQuotaTracker(50),
    });
    expect(r.ok).toBe(true);
    expect(calls[0]!.capability).toBe('compare');
    expect(calls[0]!.secondImageBytes).toEqual(new Uint8Array([4, 5, 6]));
  });
});

// =============================================================================
// 6. Camera / screen-share per-session permission (FR-VIS-03)
// =============================================================================

describe('vision — FR-VIS-03 camera / screen-share', () => {
  it('camera without sessionApproved → permission-required', async () => {
    const { caller, calls } = stubCaller();
    const r = await describeImage(
      { sensitivity: 'S0', image: tinyImage(), source: 'camera' },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('permission-required');
    expect(calls.length).toBe(0);
  });

  it('camera with sessionApproved → success', async () => {
    const { caller } = stubCaller({ text: 'ok' });
    const r = await describeImage(
      { sensitivity: 'S0', image: tinyImage(), source: 'camera', sessionApproved: true },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(true);
  });

  it('screen-share without sessionApproved → permission-required', async () => {
    const { caller } = stubCaller();
    const r = await describeImage(
      { sensitivity: 'S0', image: tinyImage(), source: 'screen-share' },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('permission-required');
  });

  it('plain upload has no permission gate', async () => {
    const { caller } = stubCaller({ text: 'ok' });
    const r = await describeImage(
      { sensitivity: 'S0', image: tinyImage() },
      { caller, quota: createQuotaTracker(50) },
    );
    expect(r.ok).toBe(true);
  });
});

// =============================================================================
// 7. T-13 laptop-safety proof — no local model anywhere
//    (Fix: strip comments before scanning. A comment that says "we don't use
//    transformers.js" must not trip the gate. Only actual imports matter.)
// =============================================================================

describe('vision — T-13 source scan', () => {
  it('no model runtime imported in the vision sources', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '..', 'src');
    const files = ['vision-v2.ts', 'preprocess-v2.ts', 'sensitive-image-v2.ts'];
    for (const file of files) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      // Strip block and line comments so prose cannot trip the gate.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(
        /onnxruntime|@xenova|tensorflow|transformers\.js|@tensorflow/i,
      );
      expect(code).not.toMatch(/from ['"]\.\.\/\.\.\/(?:.*model|.*inference)/i);
    }
  });

  it('vision-v2.ts uses the VisionCaller adapter', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'vision-v2.ts'),
      'utf8',
    );
    expect(src).toMatch(/VisionCaller/);
    expect(src).toMatch(/type VisionCaller = /);
  });

  it('sensitive-image-v2.ts is dependency-free (no imports)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'sensitive-image-v2.ts'),
      'utf8',
    );
    const importMatches = src.match(/^import\s+/gm);
    expect(importMatches).toBeNull();
  });
});
// === FILE END ===