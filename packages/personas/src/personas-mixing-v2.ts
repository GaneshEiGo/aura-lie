// === FILE START ===
// packages/personas/src/personas-mixing-v2.ts
// PRD §11.4 · FR-PERS-03 · FR-PERS-04.
//
// Convex combination of 2+ personas. Weights must be > 0 and sum to ~1.
// Output sliders are always in [0,1] by construction (convex combination of
// values already in [0,1]). Rules and banned phrases are UNIONED, then the
// mixed sliders are recomputed from the persona set.

import {
  SLIDER_KEYS,
  type Persona,
  type SliderSet,
} from './personas-roster-v2.js';

export interface MixInput {
  personas: Persona[];
  weights: number[];
  id?: string;
  name?: string;
}

export interface MixedPersona extends Persona {
  mixed_from: string[];
  weights: number[];
}

const SUM_TOLERANCE = 1e-3;

export function mixPersonas(input: MixInput): MixedPersona {
  if (input.personas.length < 2) {
    throw new Error('mixPersonas: at least 2 personas required');
  }
  if (input.personas.length !== input.weights.length) {
    throw new Error(
      `mixPersonas: personas (${input.personas.length}) and weights (${input.weights.length}) lengths differ`,
    );
  }
  if (input.weights.some((w) => w <= 0)) {
    throw new Error('mixPersonas: every weight must be > 0');
  }
  const sum = input.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error(
      `mixPersonas: weights must sum to 1 (got ${sum.toFixed(4)})`,
    );
  }

  const blended = mixSliders(input.personas.map((p) => p.sliders), input.weights);

  const rules = uniqueFlat(input.personas.flatMap((p) => p.rules));
  const banned = uniqueFlat(input.personas.flatMap((p) => p.banned));
  const anchors = input.personas.flatMap((p) => p.anchors);

  const first = input.personas[0]!;
  return {
    ...first,
    id: input.id ?? `mixed-${input.personas.map((p) => p.id).join('+')}`,
    name: input.name ?? input.personas.map((p) => p.name).join(' + '),
    sliders: blended,
    rules,
    banned,
    anchors,
    mixed_from: input.personas.map((p) => p.id),
    weights: [...input.weights],
  };
}

export function mixSliders(sets: SliderSet[], weights: number[]): SliderSet {
  const out: Record<keyof SliderSet, number> = {
    warmth: 0, humor: 0, energy: 0, skepticism: 0, bluntness: 0,
    formality: 0, verbosity: 0, creativity: 0, emoji: 0, sarcasm: 0,
  };
  for (let i = 0; i < sets.length; i++) {
    const w = weights[i]!;
    for (const k of SLIDER_KEYS) {
      out[k] += sets[i]![k] * w;
    }
  }
  for (const k of SLIDER_KEYS) {
    out[k] = clamp01(out[k]);
  }
  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function uniqueFlat(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
// === FILE END ===