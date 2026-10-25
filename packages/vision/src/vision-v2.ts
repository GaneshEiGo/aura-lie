// === FILE START ===
// packages/vision/src/vision-v2.ts
// PRD §14.2 · §12.3 · FR-VIS-01 · FR-VIS-02 · FR-VIS-03 · F-160 · F-164 · T-13.
//
// The vision layer:
//   · describeImage — describe an image, cite regions when provided
//   · ocrImage      — read text from an image
//   · critiqueUI    — critique a screenshot with region citations
//   · compareImages — compare two images
//
// Design:
//   · VisionCaller is an ADAPTER. All model invocation lives behind it; this
//     module never imports a model runtime. T-13 laptop-safety proof: the
//     source scan test asserts no onnxruntime / @xenova / tensorflow /
//     transformers.js import anywhere in this package.
//   · The sensitivity gate runs FIRST (S1/S2 short-circuit, no quota, no
//     caller). FR-VIS-01.
//   · Quota consumption only happens after every other gate passes.
//   · Resize is computed by preprocess-v2.ts and returned in the outcome.
//   · Camera and screen-share inputs require per-session permission
//     (FR-VIS-03). Regular file and image uploads do not.

import {
  computeResize,
  MAX_PIXELS,
  type ResizeDecision,
} from './preprocess-v2.js';
import {
  gateImageBySensitivity,
  SENSITIVE_IMAGE_COPY,
  type SensitivityClass,
} from './sensitive-image-v2.js';

// -----------------------------------------------------------------------------
// Adapter interface
// -----------------------------------------------------------------------------

export interface RegionCitation {
  label: string;
  /** Normalised bounding box (0..1) in the original image's frame. */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface VisionCallRequest {
  imageBytes: Uint8Array;
  mimeType: string;
  prompt: string;
  capability: 'describe' | 'ocr' | 'critique' | 'compare';
  /** Present only for `compare`. */
  secondImageBytes?: Uint8Array;
  secondMimeType?: string;
}

export interface VisionCallResponse {
  text: string;
  /** Optional region citations from the model (FR-VIS-02). */
  regions?: RegionCitation[];
}

export type VisionCaller = (req: VisionCallRequest) => Promise<VisionCallResponse>;

// -----------------------------------------------------------------------------
// Quota
// -----------------------------------------------------------------------------

/** FR-VIS-01: vision runs on Gemini free tier for 50 images. */
export const DEFAULT_DAILY_VISION_LIMIT = 50;

export interface QuotaTracker {
  used(): number;
  remaining(): number;
  limit(): number;
  /** Returns true and increments when under limit; false otherwise. */
  consume(): boolean;
}

export function createQuotaTracker(max: number = DEFAULT_DAILY_VISION_LIMIT): QuotaTracker {
  if (!Number.isFinite(max) || max < 0) {
    throw new Error('createQuotaTracker: max must be a non-negative finite number');
  }
  let used = 0;
  return {
    used: () => used,
    remaining: () => Math.max(0, max - used),
    limit: () => max,
    consume: () => {
      if (used >= max) return false;
      used += 1;
      return true;
    },
  };
}

// -----------------------------------------------------------------------------
// Inputs, deps, outcomes
// -----------------------------------------------------------------------------

export interface ImagePayload {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
}

export interface VisionInput {
  sensitivity: SensitivityClass;
  image: ImagePayload;
  /** Second image, required only for `compare`. */
  secondImage?: ImagePayload;
  /** Optional prompt override; each capability has a sensible default. */
  prompt?: string;
  /** FR-VIS-03: only set for camera or screen-share sessions. */
  source?: 'camera' | 'screen-share';
  /** FR-VIS-03: per-session approval for camera / screen-share. */
  sessionApproved?: boolean;
}

export interface VisionDeps {
  /** Adapter that performs the actual vision call. Null in Core Mode. */
  caller: VisionCaller | null;
  quota: QuotaTracker;
}

export type VisionFailureReason =
  | 'sensitive'
  | 'quota-exhausted'
  | 'no-caller'
  | 'invalid-input'
  | 'permission-required';

export interface VisionSuccess {
  ok: true;
  text: string;
  regions?: RegionCitation[];
  resized: ResizeDecision;
  quotaRemaining: number;
}

export interface VisionFailure {
  ok: false;
  reason: VisionFailureReason;
  /** Present only when reason === 'sensitive'. */
  copy?: string;
}

export type VisionOutcome = VisionSuccess | VisionFailure;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function describeImage(input: VisionInput, deps: VisionDeps): Promise<VisionOutcome> {
  return runVision(input, deps, 'describe');
}

export function ocrImage(input: VisionInput, deps: VisionDeps): Promise<VisionOutcome> {
  return runVision(input, deps, 'ocr');
}

export function critiqueUI(input: VisionInput, deps: VisionDeps): Promise<VisionOutcome> {
  return runVision(input, deps, 'critique');
}

export function compareImages(input: VisionInput, deps: VisionDeps): Promise<VisionOutcome> {
  return runVision(input, deps, 'compare');
}

// -----------------------------------------------------------------------------
// Core runner
// -----------------------------------------------------------------------------

async function runVision(
  input: VisionInput,
  deps: VisionDeps,
  capability: VisionCallRequest['capability'],
): Promise<VisionOutcome> {
  // 1. Sensitivity gate — S1/S2 short-circuits here.
  //    The exact PRD copy is returned and the caller is never invoked.
  const gate = gateImageBySensitivity(input.sensitivity);
  if (!gate.allowed) {
    return { ok: false, reason: 'sensitive', copy: gate.copy };
  }

  // 2. FR-VIS-03 — camera and screen-share require per-session approval.
  if (input.source && !input.sessionApproved) {
    return { ok: false, reason: 'permission-required' };
  }

  // 3. Input validation.
  if (!input.image || input.image.bytes.length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  if (
    !Number.isFinite(input.image.width) ||
    !Number.isFinite(input.image.height) ||
    input.image.width <= 0 ||
    input.image.height <= 0
  ) {
    return { ok: false, reason: 'invalid-input' };
  }
  if (capability === 'compare') {
    if (!input.secondImage || input.secondImage.bytes.length === 0) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (
      !Number.isFinite(input.secondImage.width) ||
      !Number.isFinite(input.secondImage.height) ||
      input.secondImage.width <= 0 ||
      input.secondImage.height <= 0
    ) {
      return { ok: false, reason: 'invalid-input' };
    }
  }

  // 4. Caller presence — Core Mode has no caller.
  if (!deps.caller) {
    return { ok: false, reason: 'no-caller' };
  }

  // 5. Compute resize decision (no side effects, no quota yet).
  const resized = computeResize({
    width: input.image.width,
    height: input.image.height,
  });

  // 6. Quota — the last gate before the call. Once we consume, we call.
  if (!deps.quota.consume()) {
    return { ok: false, reason: 'quota-exhausted' };
  }

  // 7. Build and issue the request.
  const req: VisionCallRequest = {
    imageBytes: input.image.bytes,
    mimeType: input.image.mimeType,
    prompt: input.prompt ?? defaultPromptFor(capability),
    capability,
  };
  if (capability === 'compare' && input.secondImage) {
    req.secondImageBytes = input.secondImage.bytes;
    req.secondMimeType = input.secondImage.mimeType;
  }

  const resp = await deps.caller(req);

  return {
    ok: true,
    text: resp.text,
    regions: resp.regions,
    resized,
    quotaRemaining: deps.quota.remaining(),
  };
}

function defaultPromptFor(capability: VisionCallRequest['capability']): string {
  switch (capability) {
    case 'describe':
      return 'Describe this image plainly. Note anything unusual. Do not speculate.';
    case 'ocr':
      return 'Transcribe the visible text in this image. Preserve line breaks. Do not translate.';
    case 'critique':
      return 'Critique this interface. Note concrete issues with regions where you see them.';
    case 'compare':
      return 'Compare the two images. List differences in a short, plain list.';
  }
}

// Re-exports for convenience so callers do not need to import three files.
export { MAX_PIXELS, SENSITIVE_IMAGE_COPY };
// === FILE END ===