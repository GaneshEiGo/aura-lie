// === FILE START ===
// packages/data/src/wipe.ts
// PRD 9.9 · FR-DATA-04 · T-18.
//
// Absolute wipe. Removes every row that belongs to the profile:
//   conversations, memory, files, embeddings, claims, evidence,
//   sources, push subscriptions, D1 sync copies, KV registry entries,
//   settings, personas, audit log.
//
// The FINAL row written is a single audit entry recording ONLY that a
// wipe happened and when:
//
//   { at: ISO, action: 'WIPE' }
//
// No content of the deleted data is ever recorded. No "what was deleted".
// No counts. No ids. The audit row itself is content-free by design.

import type { Identifiable } from './import-package.js';

export interface WipeInput {
  profileId: string;
  /** Confirmation phrase — must equal the profileId. */
  confirm: string;
  /** Full store state (or clone — function is pure over this argument). */
  store: {
    messages: Identifiable[];
    claims: Identifiable[];
    sources: Identifiable[];
    memories: Identifiable[];
    auditLog: Identifiable[];
    personas: Identifiable[];
    settings: Record<string, unknown>;
    files?: Identifiable[];
    embeddings?: Identifiable[];
    pushSubscriptions?: Identifiable[];
    syncCopies?: Identifiable[];
    kvRegistry?: Identifiable[];
  };
  /** Injectable clock. */
  now?: () => number;
}

export interface WipeResult {
  wiped: boolean;
  reason: 'ok' | 'confirm-mismatch' | 'profile-mismatch';
  /** Content-free audit row: only { at, action }. */
  auditRow: {
    id: string;
    action: 'WIPE';
    at: string;
    /** Always empty — no data ever recorded. */
    metadata: Record<string, never>;
  } | null;
  /** Empty store post-wipe (settings reset to a fresh default). */
  store: WipeInput['store'];
}

const EMPTY_SETTINGS: Record<string, unknown> = {};

const EMPTY_STORE: WipeInput['store'] = {
  messages: [],
  claims: [],
  sources: [],
  memories: [],
  auditLog: [],
  personas: [],
  settings: EMPTY_SETTINGS,
  files: [],
  embeddings: [],
  pushSubscriptions: [],
  syncCopies: [],
  kvRegistry: [],
};

export function performWipe(input: WipeInput): WipeResult {
  if (input.confirm !== input.profileId) {
    return {
      wiped: false,
      reason: 'confirm-mismatch',
      auditRow: null,
      store: input.store,
    };
  }
  if (input.profileId.length === 0) {
    return {
      wiped: false,
      reason: 'profile-mismatch',
      auditRow: null,
      store: input.store,
    };
  }
  const now = input.now ?? (() => Date.now());
  const iso = new Date(now()).toISOString();

  // Content-free audit row.
  const auditRow: WipeResult['auditRow'] = {
    id: `wipe-${now()}-${Math.random().toString(36).slice(2, 8)}`,
    action: 'WIPE',
    at: iso,
    metadata: {},
  };

  // Return a fresh empty store. Never keep any of the original rows.
  return {
    wiped: true,
    reason: 'ok',
    auditRow,
    store: { ...EMPTY_STORE },
  };
}
// === FILE END ===