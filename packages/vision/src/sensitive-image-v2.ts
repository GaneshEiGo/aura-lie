// === FILE START ===
// packages/vision/src/sensitive-image-v2.ts
// PRD §14.2 · §12.3 · FR-VIS-01 · T-13.
//
// Sensitivity gate for images. Per PRD §12.3:
//   S0 — public, general:        any lane
//   S1 — personal but ordinary:  private lane preferred
//   S2 — health, finance, …:     private lane only
//
// The vision model (Gemini Flash-class) is on the TRAINING-RISK lane, so S1
// and S2 images must not go to it. Per FR-VIS-01:
//   "S1/S2 images get an honest 'not analysed by design'"
//
// Per PRD §3.4 ("Things Aura-lie will never fake") the honest copy is the
// exact string from Appendix I:
//   "Sensitive image. Not analysed, by design."
//
// This module is intentionally tiny and dependency-free. It has no image
// decode path, no model, no bytes — it only reports the gate decision.
//
// The gate order in runVision (see vision-v2.ts) checks this FIRST, before
// input validation, quota, or caller — the honest message never touches
// the image or spends quota.

export type SensitivityClass = 'S0' | 'S1' | 'S2';

/** Exact PRD §14.2 / Appendix I copy. Do not paraphrase. */
export const SENSITIVE_IMAGE_COPY = 'Sensitive image. Not analysed, by design.';

export interface VisionGate {
  /** true when the image may reach the vision model. */
  allowed: boolean;
  /** 'allowed' for S0; 'sensitive' for S1/S2. */
  reason: 'allowed' | 'sensitive';
  /** Empty string when allowed; the exact PRD copy when blocked. */
  copy: string;
}

export function gateImageBySensitivity(cls: SensitivityClass): VisionGate {
  if (cls === 'S0') {
    return { allowed: true, reason: 'allowed', copy: '' };
  }
  return {
    allowed: false,
    reason: 'sensitive',
    copy: SENSITIVE_IMAGE_COPY,
  };
}
// === FILE END ===