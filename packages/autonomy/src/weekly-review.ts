// === FILE START ===
// packages/autonomy/src/weekly-review.ts
// PRD §10.7 · F-090 · FR-PRO-09.
//
// Weekly review is surfaced as ONE digest item, not many. The body carries
// counts that come from real events, never from a model.

export interface WeeklyReview {
  week_start: string;
  week_end: string;
  conversations: number;
  claims_checked: number;
  open_loops_closed: number;
  open_loops_remaining: number;
  stale_memories: number;
  decisions_made: number;
  not_useful_notes: number;
}

export type WeeklyReviewInput = WeeklyReview;

export function composeWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  return { ...input };
}

export interface WeeklyReviewDigest {
  lines: string[];
  one_line: string;
}

export function digestWeeklyReview(r: WeeklyReview): WeeklyReviewDigest {
  const lines: string[] = [];
  if (r.conversations > 0) lines.push(`${r.conversations} conversations`);
  if (r.claims_checked > 0) lines.push(`${r.claims_checked} claims checked`);
  if (r.open_loops_closed > 0) lines.push(`${r.open_loops_closed} open loops closed`);
  if (r.open_loops_remaining > 0) lines.push(`${r.open_loops_remaining} open loops remaining`);
  if (r.stale_memories > 0) lines.push(`${r.stale_memories} stale memories to clean up`);
  if (r.decisions_made > 0) lines.push(`${r.decisions_made} decisions made`);
  const one_line =
    lines.length > 0
      ? `This week: ${lines.slice(0, 3).join(' · ')}.`
      : 'Quiet week. Nothing to clean up.';
  return { lines, one_line };
}

export interface WeeklyReviewDigestItem {
  title: string;
  one_line: string;
}

/** PRD §10.7: weekly review is one item, not many. */
export function toSingleDigestItem(r: WeeklyReview): WeeklyReviewDigestItem {
  return {
    title: 'Weekly review',
    one_line: digestWeeklyReview(r).one_line,
  };
}
// === FILE END ===