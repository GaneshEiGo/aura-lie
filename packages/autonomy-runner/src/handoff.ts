// packages/autonomy-runner/src/handoff.ts
// FR-AGENT-05: "Workers pass structured objects (claims, sources,
// contradictions), not raw transcripts. This saves quota."

import type { HandoffPayload } from './types.js';

export interface HandoffValidation {
  valid: boolean;
  reason?: string;
}

const STRUCTURED_KEYS = new Set([
  'claims',
  'sources',
  'contradictions',
  'notes',
]);
const TRANSCRIPT_KEYS = new Set([
  'transcript',
  'conversation',
  'messages',
  'raw',
  'text',
  'content',
]);

export function validateHandoff(payload: unknown): HandoffValidation {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'handoff payload is not an object' };
  }
  const obj = payload as Record<string, unknown>;

  // Reject long raw transcript fields
  for (const key of Object.keys(obj)) {
    if (TRANSCRIPT_KEYS.has(key)) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 1000) {
        return {
          valid: false,
          reason:
            'handoff contains a raw transcript; only structured objects are allowed (FR-AGENT-05)',
        };
      }
    }
  }

  // Must have at least one structured field
  if (!Object.keys(obj).some((k) => STRUCTURED_KEYS.has(k))) {
    return {
      valid: false,
      reason:
        'handoff must contain at least one of: claims, sources, contradictions, notes',
    };
  }

  const p = obj as HandoffPayload;

  if (p.claims !== undefined) {
    if (!Array.isArray(p.claims)) {
      return { valid: false, reason: 'claims must be an array' };
    }
    for (const c of p.claims) {
      if (!c.id || !c.text || !c.status) {
        return {
          valid: false,
          reason: 'each claim requires id, text, and status',
        };
      }
    }
  }

  if (p.sources !== undefined) {
    if (!Array.isArray(p.sources)) {
      return { valid: false, reason: 'sources must be an array' };
    }
    for (const s of p.sources) {
      if (!s.id || !s.url) {
        return { valid: false, reason: 'each source requires id and url' };
      }
    }
  }

  if (p.contradictions !== undefined) {
    if (!Array.isArray(p.contradictions)) {
      return { valid: false, reason: 'contradictions must be an array' };
    }
  }

  return { valid: true };
}