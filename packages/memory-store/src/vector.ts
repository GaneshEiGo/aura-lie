// packages/memory-store/src/vector.ts
// PRD 9.6 step 2: int8 quantisation + brute-force cosine. Arithmetic only.
//
// Quantisation uses **symmetric rounding (round-half-away-from-zero)**.
// JavaScript's Math.round(-63.5) = -63 (rounds toward +∞), which biases
// every negative component toward zero. Symmetric rounding keeps the
// quantiser unbiased: +0.5 → +64 and -0.5 → -64.

/**
 * Quantise a float vector into int8 by scaling by 127 and symmetric-rounding.
 * Values outside [-1, 1] are clamped to ±127 after rounding.
 */
export function quantizeInt8(values: number[]): Int8Array {
  const out = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const scaled = values[i] * 127;
    // Round half away from zero: -(round(63.5)) = -64, round(63.5) = 64.
    const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
    out[i] = Math.max(-127, Math.min(127, rounded));
  }
  return out;
}

/** Reconstruct the float vector. Used only at search time. */
export function dequantizeInt8(values: Int8Array): number[] {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / 127;
  return out;
}

/** Brute-force cosine over int8 vectors (the 20,000-chunk case). */
export function cosineInt8(a: Int8Array, b: Int8Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Full-float cosine, used to compare a query embedding against a cached int8 doc. */
export function cosineFloat(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}