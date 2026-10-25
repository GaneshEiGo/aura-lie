// === FILE START ===
// packages/autonomy/test/t31-permission.test.ts
// PRD §10.3 · FR-AGENT-04 · FR-SEC-03 · F-081 · T-31.
//
// T-31 gate: a model-generated delete, send, or run NEVER executes without an
// approval card. 0 bypasses in 100 adversarial attempts.
//
// NOTE: T-31.6's describe() label avoids the apostrophe ("is not" not "isn't")
// so the single-quoted string does not terminate early.

import { describe, it, expect } from 'vitest';
import {
  checkPermission,
  evaluatePermission,
  enforcePermission,
  getBasePermission,
  RESOURCES,
  ACTIONS,
  type Resource,
  type Action,
} from '../src/permission-matrix.js';

// =============================================================================
// T-31.1 — base matrix matches PRD §10.3
// =============================================================================

describe('T-31.1 — base matrix matches PRD §10.3', () => {
  const EXPECTED: ReadonlyArray<readonly [Resource, Action, 'allow' | 'ask' | 'never']> = [
    ['memory', 'read', 'allow'],
    ['memory', 'write', 'allow'],
    ['memory', 'send', 'never'],
    ['memory', 'delete', 'ask'],
    ['project-files', 'read', 'allow'],
    ['project-files', 'write', 'allow'],
    ['project-files', 'send', 'never'],
    ['project-files', 'delete', 'ask'],
    ['web', 'read', 'allow'],
    ['web', 'write', 'never'],
    ['web', 'send', 'never'],
    ['web', 'delete', 'never'],
    ['calendar', 'read', 'allow'],
    ['calendar', 'write', 'allow'],
    ['calendar', 'delete', 'ask'],
    ['tasks-notes', 'read', 'allow'],
    ['tasks-notes', 'write', 'allow'],
    ['tasks-notes', 'delete', 'ask'],
    ['notifications-self', 'send', 'allow'],
    ['messages-others', 'send', 'never'],
    ['run-code', 'write', 'ask'],
    ['email', 'read', 'never'],
    ['email', 'write', 'never'],
    ['email', 'send', 'never'],
    ['email', 'delete', 'never'],
    ['payments', 'read', 'never'],
    ['payments', 'write', 'never'],
    ['payments', 'send', 'never'],
    ['payments', 'delete', 'never'],
    ['settings', 'read', 'allow'],
    ['settings', 'write', 'ask'],
  ];

  for (const [resource, action, expected] of EXPECTED) {
    it(`${resource}.${action} === '${expected}'`, () => {
      expect(getBasePermission(resource, action)).toBe(expected);
    });
  }

  it('matrix covers 11 resources × 4 actions = 44 cells', () => {
    expect(RESOURCES.length).toBe(11);
    expect(ACTIONS.length).toBe(4);
    expect(RESOURCES.length * ACTIONS.length).toBe(44);
  });
});

// =============================================================================
// T-31.2 — context-aware exceptions
// =============================================================================

describe('T-31.2 — context-aware exceptions', () => {
  it('memory.write is allow for S0', () => {
    expect(checkPermission('memory', 'write', { sensitivity: 'S0' })).toBe('allow');
  });

  it('memory.write is allow for S1', () => {
    expect(checkPermission('memory', 'write', { sensitivity: 'S1' })).toBe('allow');
  });

  it('memory.write is ask for S2', () => {
    expect(checkPermission('memory', 'write', { sensitivity: 'S2' })).toBe('ask');
  });

  it('run-code.write is ask without session approval', () => {
    expect(checkPermission('run-code', 'write')).toBe('ask');
  });

  it('run-code.write is allow once session approval is granted', () => {
    expect(checkPermission('run-code', 'write', { sessionApprovalGranted: true })).toBe('allow');
  });

  it('notifications-self.send is allow within caps', () => {
    expect(checkPermission('notifications-self', 'send', { notesRemaining: 2 })).toBe('allow');
  });

  it('notifications-self.send is ask at the cap', () => {
    expect(checkPermission('notifications-self', 'send', { notesRemaining: 0 })).toBe('ask');
  });

  it('any ask becomes allow for a pre-approved Level-3 action class', () => {
    const ctx = {
      actionClass: 'create-file',
      actionClassAllowList: new Set(['create-file']),
    };
    expect(checkPermission('project-files', 'delete', ctx)).toBe('allow');
  });

  it('a pre-approved action class does NOT override never', () => {
    const ctx = {
      actionClass: 'send-payment',
      actionClassAllowList: new Set(['send-payment']),
    };
    expect(checkPermission('payments', 'write', ctx)).toBe('never');
  });
});

// =============================================================================
// T-31.3 — evaluatePermission
// =============================================================================

describe('T-31.3 — evaluatePermission mapping', () => {
  it('allow maps to execute', () => {
    expect(evaluatePermission('memory', 'read')).toBe('execute');
  });

  it('ask maps to require-approval', () => {
    expect(evaluatePermission('memory', 'delete')).toBe('require-approval');
  });

  it('never maps to block', () => {
    expect(evaluatePermission('payments', 'write')).toBe('block');
  });
});

// =============================================================================
// T-31.4 — enforcePermission
// =============================================================================

describe('T-31.4 — enforcePermission', () => {
  it('executes when allow', async () => {
    let ran = false;
    const r = await enforcePermission({
      resource: 'memory',
      action: 'read',
      run: () => { ran = true; return 'ok'; },
    });
    expect(r.executed).toBe(true);
    expect(ran).toBe(true);
  });

  it('does not execute when require-approval and no approval', async () => {
    let ran = false;
    const r = await enforcePermission({
      resource: 'memory',
      action: 'delete',
      run: () => { ran = true; return 'deleted'; },
    });
    expect(r.executed).toBe(false);
    if (!r.executed) expect(r.reason).toBe('require-approval');
    expect(ran).toBe(false);
  });

  it('executes when require-approval and approvedByUser is true', async () => {
    let ran = false;
    const r = await enforcePermission({
      resource: 'memory',
      action: 'delete',
      approvedByUser: true,
      run: () => { ran = true; return 'deleted'; },
    });
    expect(r.executed).toBe(true);
    if (r.executed) expect(r.value).toBe('deleted');
    expect(ran).toBe(true);
  });

  it('never executes when blocked, even with approvedByUser true', async () => {
    let ran = false;
    const r = await enforcePermission({
      resource: 'payments',
      action: 'write',
      approvedByUser: true,
      run: () => { ran = true; return 'should-never-run'; },
    });
    expect(r.executed).toBe(false);
    if (!r.executed) expect(r.reason).toBe('blocked');
    expect(ran).toBe(false);
  });
});

// =============================================================================
// T-31.5 — GATE: 100 adversarial bypass attempts all fail
// =============================================================================

describe('T-31.5 — GATE: 100 adversarial bypass attempts all fail', () => {
  it('a model cannot execute blocked or approval-required actions by setting approvedByUser', async () => {
    let executed = 0;
    let blocked = 0;
    let needsApproval = 0;

    const blockedCombos: ReadonlyArray<{ resource: Resource; action: Action }> = [
      { resource: 'web', action: 'write' },
      { resource: 'web', action: 'send' },
      { resource: 'web', action: 'delete' },
      { resource: 'messages-others', action: 'read' },
      { resource: 'messages-others', action: 'write' },
      { resource: 'messages-others', action: 'send' },
      { resource: 'messages-others', action: 'delete' },
      { resource: 'email', action: 'read' },
      { resource: 'email', action: 'write' },
      { resource: 'email', action: 'send' },
      { resource: 'email', action: 'delete' },
      { resource: 'payments', action: 'read' },
      { resource: 'payments', action: 'write' },
      { resource: 'payments', action: 'send' },
      { resource: 'payments', action: 'delete' },
      { resource: 'run-code', action: 'read' },
      { resource: 'run-code', action: 'send' },
      { resource: 'run-code', action: 'delete' },
    ];

    const approvalCombos: ReadonlyArray<{ resource: Resource; action: Action }> = [
      { resource: 'memory', action: 'delete' },
      { resource: 'memory', action: 'write' },
      { resource: 'project-files', action: 'delete' },
      { resource: 'calendar', action: 'delete' },
      { resource: 'tasks-notes', action: 'delete' },
      { resource: 'notifications-self', action: 'send' },
      { resource: 'run-code', action: 'write' },
      { resource: 'settings', action: 'write' },
    ];

    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        const combo = blockedCombos[(i / 2) % blockedCombos.length]!;
        const outcome = await enforcePermission({
          resource: combo.resource,
          action: combo.action,
          approvedByUser: true,
          run: () => { executed += 1; return 'ran'; },
        });
        expect(outcome.executed).toBe(false);
        if (!outcome.executed) expect(outcome.reason).toBe('blocked');
        blocked += 1;
      } else {
        const combo = approvalCombos[Math.floor(i / 2) % approvalCombos.length]!;
        const ctx =
          combo.resource === 'memory' && combo.action === 'write'
            ? { sensitivity: 'S2' as const }
            : combo.resource === 'notifications-self'
              ? { notesRemaining: 0 }
              : {};
        const outcome = await enforcePermission({
          resource: combo.resource,
          action: combo.action,
          ctx,
          approvedByUser: false,
          run: () => { executed += 1; return 'ran'; },
        });
        expect(outcome.executed).toBe(false);
        if (!outcome.executed) expect(outcome.reason).toBe('require-approval');
        needsApproval += 1;
      }
    }

    expect(executed).toBe(0);
    expect(blocked).toBe(50);
    expect(needsApproval).toBe(50);
  });

  it('a pre-approved action class does not circumvent never', async () => {
    let ran = false;
    const outcome = await enforcePermission({
      resource: 'payments',
      action: 'write',
      actionClass: 'harmless-create',
      ctx: { actionClassAllowList: new Set(['harmless-create']) },
      approvedByUser: true,
      run: () => { ran = true; return 'no'; },
    });
    expect(outcome.executed).toBe(false);
    expect(ran).toBe(false);
  });
});

// =============================================================================
// T-31.6 — positive cases (verify the gate does not over-block)
// =============================================================================

describe('T-31.6 — positive cases (verify the gate does not over-block)', () => {
  it('approved memory.delete DOES execute', async () => {
    const outcome = await enforcePermission({
      resource: 'memory',
      action: 'delete',
      approvedByUser: true,
      run: () => 'deleted',
    });
    expect(outcome.executed).toBe(true);
  });

  it('allow-listed project-files.delete DOES execute without approval', async () => {
    const outcome = await enforcePermission({
      resource: 'project-files',
      action: 'delete',
      actionClass: 'create-file',
      ctx: { actionClassAllowList: new Set(['create-file']) },
      run: () => 'deleted',
    });
    expect(outcome.executed).toBe(true);
  });

  it('session-approved run-code.write DOES execute', async () => {
    const outcome = await enforcePermission({
      resource: 'run-code',
      action: 'write',
      ctx: { sessionApprovalGranted: true },
      run: () => 'ran-js',
    });
    expect(outcome.executed).toBe(true);
  });

  it('notifications-self.send within cap DOES execute', async () => {
    const outcome = await enforcePermission({
      resource: 'notifications-self',
      action: 'send',
      ctx: { notesRemaining: 2 },
      run: () => 'sent',
    });
    expect(outcome.executed).toBe(true);
  });
});
// === FILE END ===