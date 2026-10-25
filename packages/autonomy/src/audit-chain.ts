// === FILE START ===
// packages/autonomy/src/audit-chain.ts
// PRD §10.10 · F-083 · F-285 · FR-SEC-03.
//
// Hash-chained audit log. Every autonomous action writes one row:
//   time, kind, reason, input hash, tool, output summary, result, approvals.
//   Kept 400 days. Tamper-evident.
//
// Chain design:
//   hash[i]  = SHA-256( baseHash_or_prevHash | canonicalJSON(row_i_without_hashes) )
//   prevHash = previous row's hash, or `chain.baseHash` for the first row
//
// Pruning (400-day retention) drops the OLDEST contiguous rows and moves
// `chain.baseHash` forward to the hash of the last pruned row. This keeps
// the retained window fully verifiable AND lets a verifier that remembers
// the pre-prune tip detect that pruning happened (baseHash ≠ GENESIS).
//
// Uses WebCrypto SubtleCrypto — available in Node 18+, browsers, Workers.

export interface AuditRow {
  seq: number;
  at: string; // ISO 8601
  action: string;
  reason: string;
  inputHash: string | null;
  tool: string | null;
  outputSummary: string | null;
  result: 'ok' | 'error' | 'blocked';
  approvals: string[];
  prevHash: string;
  hash: string;
}

export interface AuditChain {
  /** Where verification starts. GENESIS_HASH until the first prune. */
  baseHash: string;
  rows: AuditRow[];
  /** Chain tip = hash of the last row (or GENESIS if empty). */
  lastHash: string;
  /** Monotonic sequence counter, survives pruning. */
  lastSeq: number;
}

export const GENESIS_HASH = '0'.repeat(64);
export const RETENTION_DAYS = 400;

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function emptyChain(): AuditChain {
  return { baseHash: GENESIS_HASH, rows: [], lastHash: GENESIS_HASH, lastSeq: 0 };
}

interface HashInput {
  seq: number;
  at: string;
  action: string;
  reason: string;
  inputHash: string | null;
  tool: string | null;
  outputSummary: string | null;
  result: 'ok' | 'error' | 'blocked';
  approvals: string[];
}

function canonical(f: HashInput): string {
  // Explicit field order — deterministic across JS engines.
  return JSON.stringify({
    seq: f.seq,
    at: f.at,
    action: f.action,
    reason: f.reason,
    inputHash: f.inputHash,
    tool: f.tool,
    outputSummary: f.outputSummary,
    result: f.result,
    approvals: f.approvals,
  });
}

export interface AppendInput {
  action: string;
  reason: string;
  inputHash?: string | null;
  tool?: string | null;
  outputSummary?: string | null;
  result: 'ok' | 'error' | 'blocked';
  approvals?: string[];
  /** Injectable clock for tests. */
  now?: () => number;
}

export async function appendAuditRow(
  chain: AuditChain,
  input: AppendInput,
): Promise<AuditRow> {
  const now = input.now ?? Date.now;
  const at = new Date(now()).toISOString();
  const seq = chain.lastSeq + 1;
  const prevHash = chain.lastHash;

  const fields: HashInput = {
    seq,
    at,
    action: input.action,
    reason: input.reason,
    inputHash: input.inputHash ?? null,
    tool: input.tool ?? null,
    outputSummary: input.outputSummary ?? null,
    result: input.result,
    approvals: input.approvals ?? [],
  };

  const hash = await sha256Hex(prevHash + '|' + canonical(fields));

  return { ...fields, prevHash, hash };
}

export async function appendToChain(
  chain: AuditChain,
  input: AppendInput,
): Promise<{ chain: AuditChain; row: AuditRow }> {
  const row = await appendAuditRow(chain, input);
  return {
    chain: {
      baseHash: chain.baseHash,
      rows: [...chain.rows, row],
      lastHash: row.hash,
      lastSeq: row.seq,
    },
    row,
  };
}

export interface VerifyResult {
  valid: boolean;
  firstBadSeq: number | null;
  reason: 'prevHash mismatch' | 'hash mismatch' | 'lastHash mismatch' | null;
}

export async function verifyChain(chain: AuditChain): Promise<VerifyResult> {
  let prevHash = chain.baseHash;
  for (const row of chain.rows) {
    if (row.prevHash !== prevHash) {
      return { valid: false, firstBadSeq: row.seq, reason: 'prevHash mismatch' };
    }
    const expected = await sha256Hex(prevHash + '|' + canonical(row));
    if (expected !== row.hash) {
      return { valid: false, firstBadSeq: row.seq, reason: 'hash mismatch' };
    }
    prevHash = row.hash;
  }
  if (chain.lastHash !== prevHash) {
    return { valid: false, firstBadSeq: null, reason: 'lastHash mismatch' };
  }
  return { valid: true, firstBadSeq: null, reason: null };
}

export interface PruneResult {
  chain: AuditChain;
  pruned: number;
}

/**
 * Retain only the last `retentionDays` worth of rows. Prunes from the
 * start of the chain (contiguous). Moves `baseHash` to the hash of the
 * last pruned row, so the retained window stays verifiable AND an
 * external witness of the pre-prune tip can detect that pruning happened.
 */
export async function pruneOldRows(
  chain: AuditChain,
  opts: { now?: () => number; retentionDays?: number } = {},
): Promise<PruneResult> {
  const retentionDays = opts.retentionDays ?? RETENTION_DAYS;
  const now = (opts.now ?? Date.now)();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  let k = 0;
  while (k < chain.rows.length && Date.parse(chain.rows[k]!.at) < cutoff) {
    k += 1;
  }
  if (k === 0) return { chain, pruned: 0 };

  const newBaseHash = chain.rows[k - 1]!.hash;
  return {
    chain: {
      baseHash: newBaseHash,
      rows: chain.rows.slice(k),
      lastHash: chain.lastHash,
      lastSeq: chain.lastSeq,
    },
    pruned: k,
  };
}
// === FILE END ===