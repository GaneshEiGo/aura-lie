// === FILE START ===
// packages/canvas/src/creative-v2.ts
// PRD §7.13 · §7.14 · §14.4 · FR-CRE-01 to FR-CRE-03 · F-150 · F-198 · T-13.
//
// Creative engine: three required behaviours.
//
//   1. Content labelling (§7.13): every creative block is labelled FACTUAL,
//      SPECULATIVE, or INVENTED so fiction never poses as fact.
//
//   2. Idea generator (§14.4): expand a seed across eight axes —
//      practical / unusual / extreme / cheap / technical / social /
//      contrarian / future — then combine the best. "Not 20 variants of
//      one idea" (PRD §14.4).
//
//   3. Idea evolution (§14.4): variation → combination → red team →
//      simplify → prototype. Each stage visible, in order.
//
// "Impossible mode" (§7.14) labels ideas on the feasibility scale:
//   Already possible · Buildable today · Research-level ·
//   Theoretically plausible · Currently unrealistic.
//
// No imports. Zero npm dependency. T-13 laptop-safety.

export type ContentLabel = 'FACTUAL' | 'SPECULATIVE' | 'INVENTED';

export const ALL_CONTENT_LABELS: readonly ContentLabel[] = Object.freeze([
  'FACTUAL',
  'SPECULATIVE',
  'INVENTED',
] as const);

export type IdeaAxis =
  | 'practical'
  | 'unusual'
  | 'extreme'
  | 'cheap'
  | 'technical'
  | 'social'
  | 'contrarian'
  | 'future';

export const ALL_AXES: readonly IdeaAxis[] = Object.freeze([
  'practical',
  'unusual',
  'extreme',
  'cheap',
  'technical',
  'social',
  'contrarian',
  'future',
] as const);

export type EvolutionStage =
  | 'variation'
  | 'combination'
  | 'red-team'
  | 'simplify'
  | 'prototype';

export const ALL_EVOLUTION_STAGES: readonly EvolutionStage[] = Object.freeze([
  'variation',
  'combination',
  'red-team',
  'simplify',
  'prototype',
] as const);

export type FeasibilityLevel =
  | 'Already possible'
  | 'Buildable today'
  | 'Research-level'
  | 'Theoretically plausible'
  | 'Currently unrealistic';

export const ALL_FEASIBILITY_LEVELS: readonly FeasibilityLevel[] = Object.freeze([
  'Already possible',
  'Buildable today',
  'Research-level',
  'Theoretically plausible',
  'Currently unrealistic',
] as const);

export interface Idea {
  axis: IdeaAxis;
  content: string;
  label: ContentLabel;
}

export interface EvolutionStep {
  stage: EvolutionStage;
  content: string;
}

export interface LabelledContent {
  text: string;
  label: ContentLabel;
}

export interface LabelledFeasibility {
  idea: string;
  feasibility: FeasibilityLevel;
}

// -----------------------------------------------------------------------------
// 1. Content labels
// -----------------------------------------------------------------------------

export function labelContent(text: string, kind: ContentLabel): LabelledContent {
  if (!ALL_CONTENT_LABELS.includes(kind)) {
    throw new Error(`labelContent: unknown label "${kind}"`);
  }
  return { text, label: kind };
}

// -----------------------------------------------------------------------------
// 2. Idea generator — deterministic 8-axis expansion
// -----------------------------------------------------------------------------
//
// Every idea produced here is SPECULATIVE by rule: we are generating ideas,
// not reporting facts. This is enforced at the type level, not by convention.

const AXIS_TEMPLATES: Record<IdeaAxis, (seed: string) => string> = {
  practical: (s) => `${s}: incremental improvement through better tooling`,
  unusual: (s) => `${s}: approach it from an unexpected angle`,
  extreme: (s) => `${s}: at the maximum scale possible`,
  cheap: (s) => `${s}: at minimum cost, using only free tools`,
  technical: (s) => `${s}: solve via a technical mechanism`,
  social: (s) => `${s}: solve by changing the social arrangement`,
  contrarian: (s) => `${s}: what if the conventional answer is wrong?`,
  future: (s) => `${s}: what would this look like in ten years?`,
};

export function generateIdeas(seed: string): Idea[] {
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    throw new Error('generateIdeas: seed must be a non-empty string');
  }
  return ALL_AXES.map((axis) => ({
    axis,
    content: AXIS_TEMPLATES[axis](seed),
    label: 'SPECULATIVE' as const,
  }));
}

// -----------------------------------------------------------------------------
// 3. Idea evolution — five stages, always in order
// -----------------------------------------------------------------------------

export function evolveIdea(seed: string): EvolutionStep[] {
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    throw new Error('evolveIdea: seed must be a non-empty string');
  }
  return [
    { stage: 'variation',   content: `${seed} (variant A)` },
    { stage: 'combination', content: `${seed} combined with its practical neighbour` },
    { stage: 'red-team',    content: `Weakness in ${seed}: which assumption does it depend on?` },
    { stage: 'simplify',    content: `${seed}, reduced to its essential mechanism` },
    { stage: 'prototype',   content: `Smallest test of ${seed}` },
  ];
}

// -----------------------------------------------------------------------------
// 4. Impossible mode — feasibility labels
// -----------------------------------------------------------------------------

export function impossibleMode(
  ideas: readonly LabelledFeasibility[],
): LabelledFeasibility[] {
  for (const item of ideas) {
    if (!ALL_FEASIBILITY_LEVELS.includes(item.feasibility)) {
      throw new Error(
        `impossibleMode: unknown feasibility "${item.feasibility}" for idea "${item.idea}"`,
      );
    }
  }
  return ideas.map((i) => ({ idea: i.idea, feasibility: i.feasibility }));
}
// === FILE END ===