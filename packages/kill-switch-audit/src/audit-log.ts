// packages/kill-switch-audit/src/audit-log.ts
// PRD 10.10, F-083, F-285. The tamper-evident audit log.

import type {
  AuditEntry,
  AuditInput,
  ChainVerifyResult,
} from './types.js';
import { AUDIT_RETENTION_DAYS, GENESIS_HASH } from './types.js';
import { sha256Hex } from './sha256.js';

/**
 * Canonical, deterministic stringifier. Sorted keys; arrays preserved.
 * Two equal objects always serialize identically.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`,
    );
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** The hash of a row given the fields (everything except `hash`). */
export function hashRow(row: Omit<AuditEntry, 'hash'>): string {
  return sha256Hex(canonicalStringify(row));
}

/** SHA-256 of an arbitrary input payload. Used for `inputHash`. */
export function hashInput(payload: unknown): string {
  if (payload === undefined) return GENESIS_HASH;
  return sha256Hex(canonicalStringify(payload));
}

/**
 * Standalone chain verifier — works on any entry array (test tamper-detection
 * against external mutations without poking the log's internals).
 */
export function verifyChain(entries: AuditEntry[]): ChainVerifyResult {
  let prev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== prev) {
      return {
        valid: false,
        count: entries.length,
        brokenAt: entry.id,
        reason: `prevHash mismatch (expected ${prev.slice(0, 12)}…, got ${entry.prevHash.slice(0, 12)}…)`,
      };
    }
    const { hash, ...row } = entry;
    const expected = hashRow(row);
    if (expected !== hash) {
      return {
        valid: false,
        count: entries.length,
        brokenAt: entry.id,
        reason: `hash mismatch (expected ${expected.slice(0, 12)}…, got ${hash.slice(0, 12)}…)`,
      };
    }
    prev = hash;
  }
  return { valid: true, count: entries.length };
}

export interface AuditLogOptions {
  clock?: { now(): number };
  /** Seed id counter (e.g. restored from D1). */
  startId?: number;
}

export class HashChainedAuditLog {
  private entries: AuditEntry[] = [];
  private lastHash: string = GENESIS_HASH;
  private nextId: number;
  private readonly clock: { now(): number };

  constructor(options: AuditLogOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.nextId = options.startId ?? 1;
  }

  /** PRD 10.10: append one row. */
  record(input: AuditInput): AuditEntry {
    if (!input.actor) throw new Error('audit.record: actor is required');
    if (!input.reason) throw new Error('audit.record: reason is required');

    const at = input.at ?? this.clock.now();
    const id = `audit-${String(this.nextId++).padStart(8, '0')}`;

    const row: Omit<AuditEntry, 'hash'> = {
      id,
      at,
      action: input.action,
      actor: input.actor,
      reason: input.reason,
      inputHash: hashInput(input.inputPayload),
      tool: input.tool ?? '',
      outputSummary: input.outputSummary ?? '',
      result: input.result ?? 'success',
      approvals: input.approvals ? [...input.approvals] : [],
      prevHash: this.lastHash,
    };

    const entry: AuditEntry = { ...row, hash: hashRow(row) };
    this.entries.push(entry);
    this.lastHash = entry.hash;
    return { ...entry, approvals: [...entry.approvals] };
  }

  /** F-285: verify the whole chain. */
  verifyChain(): ChainVerifyResult {
    return verifyChain(this.entries);
  }

  /** All entries, oldest first. Returns clones. */
  all(): AuditEntry[] {
    return this.entries.map(cloneEntry);
  }

  /** Most recent entry's hash (the current chain head). */
  headHash(): string {
    return this.lastHash;
  }

  /** PRD 10.10 "Searchable": filter by action. */
  byAction(action: AuditEntry['action']): AuditEntry[] {
    return this.entries.filter((e) => e.action === action).map(cloneEntry);
  }

  /** PRD 10.10 "Searchable": filter by actor. */
  byActor(actor: string): AuditEntry[] {
    return this.entries.filter((e) => e.actor === actor).map(cloneEntry);
  }

  /** General-purpose search. */
  search(predicate: (entry: AuditEntry) => boolean): AuditEntry[] {
    return this.entries.filter(predicate).map(cloneEntry);
  }

  /**
   * PRD 10.10: "Kept 400 days."
   * Delete rows older than `now - maxAgeDays * 86_400_000`.
   * NOTE: pruning breaks `verifyChain()` for older entries by design — the
   * chain keeps growing from whatever remains. Callers should re-seed via
   * `headHash()` when restoring from D1.
   */
  pruneOlderThan(maxAgeDays: number = AUDIT_RETENTION_DAYS): number {
    const cutoff = this.clock.now() - maxAgeDays * 86_400_000;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.at >= cutoff);
    if (this.entries.length > 0) {
      this.lastHash = this.entries[this.entries.length - 1].hash;
    } else {
      this.lastHash = GENESIS_HASH;
    }
    return before - this.entries.length;
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.lastHash = GENESIS_HASH;
    this.nextId = 1;
  }
}

function cloneEntry(entry: AuditEntry): AuditEntry {
  return { ...entry, approvals: [...entry.approvals] };
}