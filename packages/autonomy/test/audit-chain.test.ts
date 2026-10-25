// === FILE START ===
// packages/autonomy/test/audit-chain.test.ts
// PRD §10.10 · F-083 · F-285 · FR-SEC-03.
//
// F-285 tamper-evidence. Hash-chained audit log:
//   hash[i] = SHA-256(prevHash | canonicalJSON(row_i))
// Prev-hash links every row. Any modification breaks the chain.
// Retention is 400 days (PRD §10.10).

import { describe, it, expect } from 'vitest';
import {
  appendToChain,
  emptyChain,
  verifyChain,
  pruneOldRows,
  GENESIS_HASH,
  RETENTION_DAYS,
} from '../src/audit-chain.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const nowAt = (offsetMs: number) => () => T0 + offsetMs;

describe('audit chain — basic integrity', () => {
  it('empty chain verifies', async () => {
    expect((await verifyChain(emptyChain())).valid).toBe(true);
  });

  it('one appended row → chain valid', async () => {
    const { chain } = await appendToChain(emptyChain(), {
      action: 'test', reason: 'unit', result: 'ok', now: nowAt(0),
    });
    expect(chain.rows.length).toBe(1);
    expect(chain.rows[0]!.seq).toBe(1);
    expect(chain.rows[0]!.prevHash).toBe(GENESIS_HASH);
    expect(chain.lastHash).toBe(chain.rows[0]!.hash);
    expect((await verifyChain(chain)).valid).toBe(true);
  });

  it('many appended rows → chain valid, seq monotonic', async () => {
    let chain = emptyChain();
    for (let i = 0; i < 5; i++) {
      chain = (await appendToChain(chain, {
        action: `a${i}`, reason: `r${i}`, result: 'ok', now: nowAt(i * 1000),
      })).chain;
    }
    expect(chain.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await verifyChain(chain)).valid).toBe(true);
  });

  it('rows carry ISO timestamps from the injected clock', async () => {
    const { chain } = await appendToChain(emptyChain(), {
      action: 'a', reason: 'r', result: 'ok', now: () => T0,
    });
    expect(chain.rows[0]!.at).toBe(new Date(T0).toISOString());
  });
});

describe('audit chain — tamper detection', () => {
  it('tampering with row content → verify fails at that seq', async () => {
    let chain = emptyChain();
    for (let i = 0; i < 3; i++) {
      chain = (await appendToChain(chain, {
        action: `a${i}`, reason: `r${i}`, result: 'ok', now: nowAt(i),
      })).chain;
    }
    chain = {
      ...chain,
      rows: chain.rows.map((r, i) => (i === 1 ? { ...r, action: 'TAMPERED' } : r)),
    };
    const v = await verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.firstBadSeq).toBe(2);
    expect(v.reason).toBe('hash mismatch');
  });

  it('tampering with prevHash → verify fails at that seq', async () => {
    let chain = emptyChain();
    for (let i = 0; i < 3; i++) {
      chain = (await appendToChain(chain, {
        action: `a${i}`, reason: `r${i}`, result: 'ok', now: nowAt(i),
      })).chain;
    }
    chain = {
      ...chain,
      rows: chain.rows.map((r, i) => (i === 2 ? { ...r, prevHash: GENESIS_HASH } : r)),
    };
    const v = await verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.firstBadSeq).toBe(3);
    expect(v.reason).toBe('prevHash mismatch');
  });

  it('tampering with hash → verify fails at seq 1', async () => {
    let chain = emptyChain();
    chain = (await appendToChain(chain, {
      action: 'a', reason: 'r', result: 'ok', now: nowAt(0),
    })).chain;
    chain = { ...chain, rows: [{ ...chain.rows[0]!, hash: 'deadbeef' }] };
    const v = await verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.firstBadSeq).toBe(1);
    expect(v.reason).toBe('hash mismatch');
  });

  it('tampering with lastHash → verify fails', async () => {
    let chain = emptyChain();
    chain = (await appendToChain(chain, {
      action: 'a', reason: 'r', result: 'ok', now: nowAt(0),
    })).chain;
    chain = { ...chain, lastHash: 'deadbeef' };
    const v = await verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('lastHash mismatch');
  });

  it('truncating a row from the middle → verify fails', async () => {
    let chain = emptyChain();
    for (let i = 0; i < 3; i++) {
      chain = (await appendToChain(chain, {
        action: `a${i}`, reason: `r${i}`, result: 'ok', now: nowAt(i),
      })).chain;
    }
    chain = {
      ...chain,
      rows: [chain.rows[0]!, chain.rows[2]!], // drop middle
    };
    const v = await verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.firstBadSeq).toBe(3);
  });
});

describe('audit chain — 400-day retention', () => {
  it('RETENTION_DAYS is 400 per PRD §10.10', () => {
    expect(RETENTION_DAYS).toBe(400);
  });

  it('prunes old rows, keeps chain verifiable', async () => {
    let chain = emptyChain();
    const old = T0 - 500 * 24 * 60 * 60 * 1000;
    const recent = T0 - 10 * 24 * 60 * 60 * 1000;

    chain = (await appendToChain(chain, {
      action: 'old-1', reason: 'r', result: 'ok', now: () => old,
    })).chain;
    chain = (await appendToChain(chain, {
      action: 'old-2', reason: 'r', result: 'ok', now: () => old + 1000,
    })).chain;
    chain = (await appendToChain(chain, {
      action: 'recent', reason: 'r', result: 'ok', now: () => recent,
    })).chain;

    expect((await verifyChain(chain)).valid).toBe(true);

    const pruned = await pruneOldRows(chain, { now: () => T0 });
    expect(pruned.pruned).toBe(2);
    expect(pruned.chain.rows.length).toBe(1);
    expect(pruned.chain.rows[0]!.action).toBe('recent');
    expect(pruned.chain.baseHash).not.toBe(GENESIS_HASH);
    expect((await verifyChain(pruned.chain)).valid).toBe(true);
  });

  it('pruning nothing returns the same chain object', async () => {
    let chain = emptyChain();
    chain = (await appendToChain(chain, {
      action: 'a', reason: 'r', result: 'ok', now: () => T0,
    })).chain;
    const pruned = await pruneOldRows(chain, { now: () => T0 });
    expect(pruned.pruned).toBe(0);
    expect(pruned.chain).toBe(chain);
  });

  it('append after prune keeps chain valid and seq monotonic', async () => {
    let chain = emptyChain();
    const old = T0 - 500 * 24 * 60 * 60 * 1000;

    chain = (await appendToChain(chain, {
      action: 'old', reason: 'r', result: 'ok', now: () => old,
    })).chain;
    chain = (await appendToChain(chain, {
      action: 'kept', reason: 'r', result: 'ok', now: () => T0,
    })).chain;

    const pruned = await pruneOldRows(chain, { now: () => T0 });
    expect(pruned.pruned).toBe(1);

    const appended = await appendToChain(pruned.chain, {
      action: 'after-prune', reason: 'r', result: 'ok', now: () => T0 + 1000,
    });

    expect(appended.chain.rows.length).toBe(2);
    expect(appended.chain.rows[1]!.seq).toBe(3); // seq continues from 2
    expect((await verifyChain(appended.chain)).valid).toBe(true);
  });

  it('pruning the entire chain leaves a verifiable empty chain with a non-GENESIS base', async () => {
    let chain = emptyChain();
    const veryOld = T0 - 500 * 24 * 60 * 60 * 1000;
    chain = (await appendToChain(chain, {
      action: 'a', reason: 'r', result: 'ok', now: () => veryOld,
    })).chain;

    const pruned = await pruneOldRows(chain, { now: () => T0 });
    expect(pruned.chain.rows.length).toBe(0);
    expect(pruned.chain.baseHash).not.toBe(GENESIS_HASH);
    expect(pruned.chain.lastHash).toBe(pruned.chain.baseHash);
    expect((await verifyChain(pruned.chain)).valid).toBe(true);
  });
});

describe('audit chain — payload details', () => {
  it('records the full PRD §10.10 row shape', async () => {
    const { chain } = await appendToChain(emptyChain(), {
      action: 'CREATE_FILE',
      reason: 'open-loop draft',
      inputHash: 'abc123',
      tool: 'fs.create',
      outputSummary: 'created report.md',
      result: 'ok',
      approvals: ['approval-1'],
      now: nowAt(0),
    });
    const row = chain.rows[0]!;
    expect(row.action).toBe('CREATE_FILE');
    expect(row.reason).toBe('open-loop draft');
    expect(row.inputHash).toBe('abc123');
    expect(row.tool).toBe('fs.create');
    expect(row.outputSummary).toBe('created report.md');
    expect(row.result).toBe('ok');
    expect(row.approvals).toEqual(['approval-1']);
    expect(row.hash).toHaveLength(64); // SHA-256 hex
  });

  it('records a blocked action with result "blocked"', async () => {
    const { chain } = await appendToChain(emptyChain(), {
      action: 'SEND_PAYMENT',
      reason: 'model requested',
      result: 'blocked',
      now: nowAt(0),
    });
    expect(chain.rows[0]!.result).toBe('blocked');
  });
});
// === FILE END ===