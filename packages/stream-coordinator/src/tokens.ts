// packages/stream-coordinator/src/tokens.ts
// Client tokens encode { jobId, cursor } so a reconnect can resume.

import type { JobState } from './types.js';

const INIT_PATTERN = /^job:([^:]+):init$/;
const STEP_PATTERN = /^job:([^:]+):step:(\d+)$/;

export type ParsedToken =
  | { jobId: string; cursor: 'init' }
  | { jobId: string; cursor: number };

/** The client's first request. */
export function initialToken(job: Pick<JobState, 'id'>): string {
  return `job:${job.id}:init`;
}

/** The token that identifies the current position (i.e. the next step to run). */
export function stepTokenFor(job: Pick<JobState, 'id' | 'cursor'>): string {
  return `job:${job.id}:step:${job.cursor}`;
}

/** Parse a token. Returns null for malformed input. */
export function parseStepToken(token: string): ParsedToken | null {
  if (typeof token !== 'string') return null;
  const init = INIT_PATTERN.exec(token);
  if (init) return { jobId: init[1], cursor: 'init' };
  const step = STEP_PATTERN.exec(token);
  if (step) {
    const n = parseInt(step[2], 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return { jobId: step[1], cursor: n };
  }
  return null;
}

/** PRD 13.7: "The client shows 'Working... 3 of 8 steps'." */
export function progressLabel(job: Pick<JobState, 'cursor' | 'totalSteps'>): string {
  return `Working... ${job.cursor} of ${job.totalSteps} steps`;
}