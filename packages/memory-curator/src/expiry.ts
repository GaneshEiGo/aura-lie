// packages/memory-curator/src/expiry.ts
// PRD 9.2: type → lifetime.

import type { MemoryType } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const EPISODIC_LIFETIME_MS = 180 * DAY_MS; // 180 days
export const TEMPORAL_REVIEW_MS = 14 * DAY_MS;    // 14 days

export interface ExpiryAssignment {
  expiresAt?: number;
  reviewAt?: number;
}

export function assignExpiry(type: MemoryType, now: number): ExpiryAssignment {
  switch (type) {
    case 'episodic':
      return { expiresAt: now + EPISODIC_LIFETIME_MS };
    case 'temporal':
      return { reviewAt: now + TEMPORAL_REVIEW_MS };
    case 'semantic':
    case 'project':
      return {}; // permanent until changed or forgotten
  }
}