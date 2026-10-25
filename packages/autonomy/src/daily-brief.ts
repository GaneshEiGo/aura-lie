// === FILE START ===
// packages/autonomy/src/daily-brief.ts
// PRD §10.7 · F-089 · FR-PRO-08.
//
// Daily brief: at most 4 items in priority order, one of each kind where
// possible. The candidate list is supplied by the caller (heartbeat, open
// loops, calendar, tasks, watched sources); this module only composes,
// dedupes, prioritises and caps. The 'not useful' / 'never about this'
// feedback loop is also here so the composer's weights can decay per kind.

export type BriefItemKind = 'changed' | 'open-loop' | 'important-task' | 'worth-knowing';

export interface BriefItem {
  kind: BriefItemKind;
  title: string;
  one_line: string;
  link: string;
  priority: 1 | 2 | 3;
}

export interface DailyBrief {
  date: string;
  items: BriefItem[];
  total_considered: number;
  total_sent: number;
}

export const MAX_BRIEF_ITEMS = 4;

export interface ComposeBriefInput {
  /** YYYY-MM-DD. */
  date: string;
  candidates: BriefItem[];
}

export function composeDailyBrief(input: ComposeBriefInput): DailyBrief {
  // 1. Dedupe by (kind, title): highest-priority instance survives.
  const deduped = new Map<string, BriefItem>();
  for (const item of input.candidates) {
    const key = `${item.kind}::${item.title}`;
    const existing = deduped.get(key);
    if (!existing || item.priority < existing.priority) {
      deduped.set(key, item);
    }
  }

  // 2. Sort by priority (ascending — 1 is highest).
  const sorted = Array.from(deduped.values()).sort((a, b) => a.priority - b.priority);

  // 3. Kind-diversity: keep only the highest-priority item per kind.
  const bestPerKind = new Map<BriefItemKind, BriefItem>();
  for (const item of sorted) {
    if (!bestPerKind.has(item.kind)) {
      bestPerKind.set(item.kind, item);
    }
  }
  const ordered = sorted
    .filter((i) => bestPerKind.get(i.kind) === i)
    .slice(0, MAX_BRIEF_ITEMS);

  return {
    date: input.date,
    items: ordered,
    total_considered: input.candidates.length,
    total_sent: ordered.length,
  };
}

export type FeedbackAction = 'not-useful' | 'never-about-this';

export interface NotUsefulFeedback {
  kind: BriefItemKind;
  action: FeedbackAction;
  at: string;
}

export function recordNotUseful(
  current: NotUsefulFeedback[],
  feedback: NotUsefulFeedback,
): NotUsefulFeedback[] {
  return [...current, feedback];
}

export interface KindWeight {
  kind: BriefItemKind;
  weight: number;
}

const ALL_KINDS: readonly BriefItemKind[] = [
  'changed',
  'open-loop',
  'important-task',
  'worth-knowing',
];

export function computeKindWeights(feedback: NotUsefulFeedback[]): KindWeight[] {
  return ALL_KINDS.map((kind) => {
    const notUseful = feedback.filter(
      (f) => f.kind === kind && f.action === 'not-useful',
    ).length;
    const neverAbout = feedback.filter(
      (f) => f.kind === kind && f.action === 'never-about-this',
    ).length;
    // 10% decay per 'not-useful'; 'never-about-this' zeroes the weight.
    const base = Math.max(0, 1 - notUseful * 0.1 - (neverAbout > 0 ? 1 : 0));
    return { kind, weight: base };
  });
}
// === FILE END ===