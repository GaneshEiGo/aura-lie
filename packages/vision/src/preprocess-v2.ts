// === FILE START ===
// packages/vision/src/preprocess-v2.ts
// PRD §14.2 · FR-VIS-01 · T-13.
//
// Client-side resize policy for images before upload. Per PRD §14.2:
// "The client downsizes to about 1.5 megapixels before upload to save quota
// and bandwidth."
//
// This module computes the resize decision. It does NOT decode pixels. That
// is deliberate:
//   · T-13 laptop-safety: no image decoder runs in this module.
//   · Purity: computeResize is a pure function of (dimensions, maxPixels).
//   · Determinism: same input → same output, character for character.
//
// The actual resize is done by the caller using the platform's native image
// APIs (Canvas.drawImage / createImageBitmap). Those are lighter than any
// bundled decoder and never contain a model.

export const MAX_PIXELS = 1_500_000; // ~1.5 MP per PRD §14.2

export interface Dimensions {
  width: number;
  height: number;
}

export interface ResizeDecision {
  /** Width to send to the caller's resize. */
  width: number;
  /** Height to send to the caller's resize. */
  height: number;
  /** true when the image was over the target and was downscaled. */
  resized: boolean;
  /** Original width × height. */
  originalPixels: number;
  /** Target ceiling (default 1.5 MP). */
  targetPixels: number;
  /** Scale factor (0 < scale ≤ 1). */
  scale: number;
}

/**
 * Compute the downscale needed to fit `maxPixels`, preserving aspect ratio.
 *
 * Rules:
 *   · if already ≤ maxPixels: unchanged, resized=false, scale=1
 *   · otherwise downscale by sqrt(maxPixels / originalPixels)
 *   · NEVER upscale (a small image stays its native size)
 *   · integer pixel dimensions, floor-rounded
 *   · throws on non-finite or non-positive dimensions
 */
export function computeResize(
  input: Dimensions,
  maxPixels: number = MAX_PIXELS,
): ResizeDecision {
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    !Number.isFinite(maxPixels)
  ) {
    throw new Error('computeResize: dimensions and maxPixels must be finite');
  }
  if (input.width <= 0 || input.height <= 0) {
    throw new Error('computeResize: width and height must be > 0');
  }
  if (maxPixels <= 0) {
    throw new Error('computeResize: maxPixels must be > 0');
  }

  const originalPixels = input.width * input.height;
  if (originalPixels <= maxPixels) {
    return {
      width: input.width,
      height: input.height,
      resized: false,
      originalPixels,
      targetPixels: maxPixels,
      scale: 1,
    };
  }

  const scale = Math.sqrt(maxPixels / originalPixels);
  const newWidth = Math.max(1, Math.floor(input.width * scale));
  const newHeight = Math.max(1, Math.floor(input.height * scale));

  return {
    width: newWidth,
    height: newHeight,
    resized: true,
    originalPixels,
    targetPixels: maxPixels,
    scale,
  };
}
// === FILE END ===