// packages/permission-tools/test/permission-tools.test.ts
import { describe, it, expect } from 'vitest';
import {
  PERMISSION_MATRIX,
  lookupMatrix,
  SessionContext,
  ToolRegistry,
  validateManifest,
  enforce,
  approveApprovals,
  dryRun,
  parsePermission,
  checkPermissionCompat,
  ALL_RESOURCES,
  HARMLESS_WRITE_RESOURCES,
} from '../src/index.js';
import type {
  EnforceContext,
  Resource,
  PermissionClass,
  ToolManifest,
} from '../src/index.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeTool(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['read:web'],
    risk: 'low',
    quotaPool: null,
    timeoutMs: 5_000,
    maxOutputBytes: 10_000,
    tainting: 'none',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EnforceContext> = {}): EnforceContext {
  return {
    level: 2,
    sensitivity: 'S0',
    tainted: false,
    session: new SessionContext(),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
describe('Permission Matrix + Tool Registry (PRD 10.3, 12.1, 12.4, T-31)', () => {
  // ---- Constants ---------------------------------------------------
  it('ALL_RESOURCES contains every PRD 10.3 resource', () => {
    expect(ALL_RESOURCES).toEqual([
      'memory',
      'project-files',
      'web',
      'calendar',
      'tasks',
      'notifications',
      'messages',
      'code',
      'email',
      'payments',
      'settings',
    ]);
  });

  it('HARMLESS_WRITE_RESOURCES matches PRD 10.9', () => {
    expect(HARMLESS_WRITE_RESOURCES.sort()).toEqual(
      ['calendar', 'memory', 'notifications', 'project-files', 'tasks'].sort(),
    );
  });

  // ---- Matrix: PRD 10.3 exact cells --------------------------------
  it('memory.read = allow', () => {
    expect(lookupMatrix('memory', 'read').decision).toBe('allow');
  });

  it('memory.write = allow with S2 override', () => {
    const cell = lookupMatrix('memory', 'write');
    expect(cell.decision).toBe('allow');
    expect(cell.s2RequiresAsk).toBe(true);
  });

  it('memory.delete = ask', () => {
    expect(lookupMatrix('memory', 'delete').decision).toBe('ask');
  });

  it('project-files.write = allow', () => {
    expect(lookupMatrix('project-files', 'write').decision).toBe('allow');
  });

  it('web.read = allow', () => {
    expect(lookupMatrix('web', 'read').decision).toBe('allow');
  });

  it('calendar.delete = ask', () => {
    expect(lookupMatrix('calendar', 'delete').decision).toBe('ask');
  });

  it('tasks.delete = ask', () => {
    expect(lookupMatrix('tasks', 'delete').decision).toBe('ask');
  });

  it('notifications.send = allow (within caps)', () => {
    const cell = lookupMatrix('notifications', 'send');
    expect(cell.decision).toBe('allow');
    expect(cell.onlyWithinCaps).toBe(true);
  });

  it('messages.send = never', () => {
    expect(lookupMatrix('messages', 'send').decision).toBe('never');
  });

  it('code.write and code.execute = ask once per session', () => {
    expect(lookupMatrix('code', 'write').decision).toBe('ask');
    expect(lookupMatrix('code', 'write').askOncePerSession).toBe(true);
    expect(lookupMatrix('code', 'execute').decision).toBe('ask');
    expect(lookupMatrix('code', 'execute').askOncePerSession).toBe(true);
  });

  it('email = not_built for all classes', () => {
    for (const cls of ['read', 'write', 'send', 'delete'] as const) {
      expect(lookupMatrix('email', cls).decision).toBe('not_built');
    }
  });

  it('payments = never for all classes', () => {
    for (const cls of ['read', 'write', 'send', 'delete'] as const) {
      expect(lookupMatrix('payments', cls).decision).toBe('never');
    }
  });

  it('settings.write = ask', () => {
    expect(lookupMatrix('settings', 'write').decision).toBe('ask');
  });

  it('unknown resource/class combination defaults to never', () => {
    expect(lookupMatrix('memory', 'send').decision).toBe('never');
    expect(lookupMatrix('web', 'write').decision).toBe('never');
    expect(lookupMatrix('settings', 'delete').decision).toBe('never');
  });

  // ---- parsePermission -------------------------------------------
  it('parsePermission accepts valid permissions', () => {
    expect(parsePermission('read:web')).toEqual({ cls: 'read', resource: 'web' });
    expect(parsePermission('write:tasks')).toEqual({ cls: 'write', resource: 'tasks' });
    expect(parsePermission('execute:code')).toEqual({ cls: 'execute', resource: 'code' });
  });

  it('parsePermission rejects malformed permissions', () => {
    expect(parsePermission('')).toBeNull();
    expect(parsePermission('no-colon')).toBeNull();
    expect(parsePermission(':web')).toBeNull();
    expect(parsePermission('read:')).toBeNull();
    expect(parsePermission('bogus:web')).toBeNull();
  });

  // ---- SessionContext --------------------------------------------
  it('SessionContext tracks approvals', () => {
    const s = new SessionContext();
    expect(s.has('code.execute')).toBe(false);
    s.approve('code.execute');
    expect(s.has('code.execute')).toBe(true);
    expect(s.size()).toBe(1);
    s.reset();
    expect(s.has('code.execute')).toBe(false);
  });

  // ---- validateManifest ------------------------------------------
  it('validateManifest accepts a valid manifest', () => {
    expect(validateManifest(makeTool()).ok).toBe(true);
  });

  it('validateManifest rejects a bad id', () => {
    const r = validateManifest(makeTool({ id: 'Bad-ID!' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /snake_case/.test(e))).toBe(true);
  });

  it('validateManifest rejects unknown permission class', () => {
    const r = validateManifest(makeTool({ permissions: ['bogus:web'] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown permission class/.test(e))).toBe(true);
  });

  it('validateManifest rejects unknown resource', () => {
    const r = validateManifest(makeTool({ permissions: ['read:nowhere'] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown resource/.test(e))).toBe(true);
  });

  it('validateManifest rejects empty permissions', () => {
    const r = validateManifest(makeTool({ permissions: [] }));
    expect(r.ok).toBe(false);
  });

  it('validateManifest rejects unknown risk', () => {
    const r = validateManifest(makeTool({ risk: 'catastrophic' as any }));
    expect(r.ok).toBe(false);
  });

  it('validateManifest rejects zero timeout', () => {
    const r = validateManifest(makeTool({ timeoutMs: 0 }));
    expect(r.ok).toBe(false);
  });

  it('validateManifest rejects zero maxOutputBytes', () => {
    const r = validateManifest(makeTool({ maxOutputBytes: 0 }));
    expect(r.ok).toBe(false);
  });

  // ---- ToolRegistry ----------------------------------------------
  it('ToolRegistry register/get/list round-trips', () => {
    const reg = new ToolRegistry();
    expect(reg.register(makeTool()).ok).toBe(true);
    expect(reg.get('test_tool')).toBeDefined();
    expect(reg.list().length).toBe(1);
    expect(reg.size()).toBe(1);
  });

  it('ToolRegistry rejects duplicates', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool());
    const dup = reg.register(makeTool());
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]).toMatch(/duplicate/);
  });

  it('ToolRegistry rejects invalid manifests', () => {
    const reg = new ToolRegistry();
    const r = reg.register(makeTool({ id: 'BAD' }));
    expect(r.ok).toBe(false);
    expect(reg.size()).toBe(0);
  });

  // ---- enforce: basic --------------------------------------------
  it('enforce allows a plain read', () => {
    const result = enforce(makeTool({ permissions: ['read:web'] }), makeCtx());
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.noExternalActions).toBe(true);
  });

  it('enforce asks for memory.delete', () => {
    const result = enforce(makeTool({ permissions: ['delete:memory'] }), makeCtx());
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('enforce blocks messages.send', () => {
    const result = enforce(makeTool({ permissions: ['send:messages'] }), makeCtx());
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('send:messages');
  });

  it('enforce blocks payments.write', () => {
    const result = enforce(makeTool({ permissions: ['write:payments'] }), makeCtx());
    expect(result.allowed).toBe(false);
  });

  it('enforce blocks email.read', () => {
    const result = enforce(makeTool({ permissions: ['read:email'] }), makeCtx());
    expect(result.allowed).toBe(false);
  });

  it('enforce reports dry-run summary', () => {
    const result = enforce(
      makeTool({ permissions: ['read:web', 'write:tasks'], quotaPool: 'tasks-pool' }),
      makeCtx(),
    );
    expect(result.dryRun.wouldRead).toBe(true);
    expect(result.dryRun.wouldWrite).toBe(true);
    expect(result.dryRun.wouldSend).toBe(false);
    expect(result.dryRun.quotaPool).toBe('tasks-pool');
  });

  // ---- 10.9 harmless write level override ------------------------
  it('harmless write at Level 0 asks', () => {
    const result = enforce(
      makeTool({ permissions: ['write:memory'] }),
      makeCtx({ level: 0 }),
    );
    expect(result.requiresApproval).toBe(true);
  });

  it('harmless write at Level 1 asks', () => {
    const result = enforce(
      makeTool({ permissions: ['write:memory'] }),
      makeCtx({ level: 1 }),
    );
    expect(result.requiresApproval).toBe(true);
  });

  it('harmless write at Level 2 allows', () => {
    const result = enforce(
      makeTool({ permissions: ['write:memory'] }),
      makeCtx({ level: 2 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('harmless write at Level 3 allows', () => {
    const result = enforce(
      makeTool({ permissions: ['write:tasks'] }),
      makeCtx({ level: 3 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('settings.write still asks at Level 3 (not harmless)', () => {
    const result = enforce(
      makeTool({ permissions: ['write:settings'] }),
      makeCtx({ level: 3 }),
    );
    expect(result.requiresApproval).toBe(true);
  });

  // ---- S2 memory write -------------------------------------------
  it('S2 memory.write asks even at Level 3', () => {
    const result = enforce(
      makeTool({ permissions: ['write:memory'] }),
      makeCtx({ level: 3, sensitivity: 'S2' }),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.checks[0].reason).toMatch(/S2/);
  });

  it('S1 memory.write allows at Level 3', () => {
    const result = enforce(
      makeTool({ permissions: ['write:memory'] }),
      makeCtx({ level: 3, sensitivity: 'S1' }),
    );
    expect(result.requiresApproval).toBe(false);
  });

  // ---- 12.4 taint tracking ---------------------------------------
  it('tainted turn forces approval for write', () => {
    const result = enforce(
      makeTool({ permissions: ['write:tasks'] }),
      makeCtx({ level: 3, tainted: true }),
    );
    expect(result.requiresApproval).toBe(true);
    expect(result.checks[0].reason).toMatch(/tainted/);
  });

  it('tainted turn forces approval for send', () => {
    const result = enforce(
      makeTool({ permissions: ['send:notifications'] }),
      makeCtx({ level: 3, tainted: true }),
    );
    expect(result.requiresApproval).toBe(true);
  });

  it('tainted turn forces approval for delete', () => {
    const result = enforce(
      makeTool({ permissions: ['delete:tasks'] }),
      makeCtx({ level: 3, tainted: true }),
    );
    expect(result.requiresApproval).toBe(true);
  });

  it('tainted turn does not affect reads', () => {
    const result = enforce(
      makeTool({ permissions: ['read:web'] }),
      makeCtx({ level: 3, tainted: true }),
    );
    expect(result.requiresApproval).toBe(false);
  });

  // ---- askOncePerSession -----------------------------------------
  it('code.execute asks the first time', () => {
    const ctx = makeCtx({ level: 3 });
    const result = enforce(
      makeTool({ permissions: ['execute:code'] }),
      ctx,
    );
    expect(result.requiresApproval).toBe(true);
  });

  it('code.execute allows after session approval', () => {
    const ctx = makeCtx({ level: 3 });
    const result = enforce(
      makeTool({ permissions: ['execute:code'] }),
      ctx,
    );
    approveApprovals(result, ctx);
    const second = enforce(
      makeTool({ permissions: ['execute:code'] }),
      ctx,
    );
    expect(second.requiresApproval).toBe(false);
    expect(second.checks[0].reason).toMatch(/already approved/);
  });

  it('approveApprovals only records askOncePerSession permissions', () => {
    const ctx = makeCtx({ level: 3 });
    const result = enforce(
      makeTool({ permissions: ['delete:memory'] }),
      ctx,
    );
    approveApprovals(result, ctx);
    expect(ctx.session.size()).toBe(0);
  });

  // ---- dryRun ----------------------------------------------------
  it('dryRun returns noExternalActions: true', () => {
    const result = dryRun(makeTool({ permissions: ['write:tasks'] }), makeCtx());
    expect(result.noExternalActions).toBe(true);
  });

  it('dryRun requires approval for delete', () => {
    const result = dryRun(makeTool({ permissions: ['delete:tasks'] }), makeCtx());
    expect(result.requiresApproval).toBe(true);
  });

  // ---- T-31: 100-case fuzzers ------------------------------------
  it('T-31: 100 delete calls never execute without approval', () => {
    const resources: Resource[] = ALL_RESOURCES.slice();
    for (let i = 0; i < 100; i++) {
      const resource = resources[i % resources.length];
      const tool = makeTool({ permissions: [`delete:${resource}`] });
      const result = enforce(tool, makeCtx({ level: 3 }));
      // Either blocked or requires approval — never silently allowed.
      if (result.allowed) {
        expect(result.requiresApproval).toBe(true);
      }
    }
  });

  it('T-31: 100 send-to-others calls are never allowed', () => {
    for (let i = 0; i < 100; i++) {
      const tool = makeTool({ permissions: ['send:messages'] });
      const result = enforce(tool, makeCtx({ level: 3 }));
      expect(result.allowed).toBe(false);
    }
  });

  it('T-31: 100 execute-code calls always require approval on first run', () => {
    for (let i = 0; i < 100; i++) {
      const ctx = makeCtx({ level: 3 });
      const tool = makeTool({ permissions: ['execute:code'] });
      const result = enforce(tool, ctx);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    }
  });

  it('T-31: tainted turn blocks all write/send/delete from silent execution', () => {
    const dangerous: PermissionClass[] = ['write', 'send', 'delete'];
    for (const cls of dangerous) {
      for (const resource of ALL_RESOURCES) {
        const tool = makeTool({ permissions: [`${cls}:${resource}`] });
        const result = enforce(tool, makeCtx({ level: 3, tainted: true }));
        // If it's allowed, it MUST require approval.
        if (result.allowed) {
          expect(result.requiresApproval).toBe(true);
        }
      }
    }
  });

  // ---- Multiple permissions: strictest wins ----------------------
  it('multiple permissions: any never blocks', () => {
    const result = enforce(
      makeTool({ permissions: ['read:web', 'send:messages'] }),
      makeCtx(),
    );
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('send:messages');
  });

  it('multiple permissions: any ask requires approval', () => {
    const result = enforce(
      makeTool({ permissions: ['read:web', 'delete:tasks'] }),
      makeCtx(),
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  // ---- Autonomy-runner compat -----------------------------------
  it('compat: payments never allowed at any level', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(
        checkPermissionCompat(
          { resource: 'payments', permissionClass: 'write', irreversible: false },
          level,
        ),
      ).toBe('never');
    }
  });

  it('compat: messages.send never allowed', () => {
    expect(
      checkPermissionCompat(
        { resource: 'messages', permissionClass: 'send', irreversible: false },
        3,
      ),
    ).toBe('never');
  });

  it('compat: irreversible always asks', () => {
    expect(
      checkPermissionCompat(
        { resource: 'tasks', permissionClass: 'write', irreversible: true },
        3,
      ),
    ).toBe('ask');
  });

  it('compat: harmless write at L2 = allow', () => {
    expect(
      checkPermissionCompat(
        { resource: 'memory', permissionClass: 'write', irreversible: false },
        2,
      ),
    ).toBe('allow');
  });

  it('compat: harmless write at L1 = ask', () => {
    expect(
      checkPermissionCompat(
        { resource: 'memory', permissionClass: 'write', irreversible: false },
        1,
      ),
    ).toBe('ask');
  });

  it('compat: settings.write = ask at all levels', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(
        checkPermissionCompat(
          { resource: 'settings', permissionClass: 'write', irreversible: false },
          level,
        ),
      ).toBe('ask');
    }
  });

  it('compat: read:web = allow', () => {
    expect(
      checkPermissionCompat(
        { resource: 'web', permissionClass: 'read', irreversible: false },
        0,
      ),
    ).toBe('allow');
  });

  // ---- Registry rejects a manifest that would sneak past ----------
  it('registry rejects a manifest with a comma-split permission', () => {
    const r = validateManifest(makeTool({ permissions: ['read:web,write:tasks'] }));
    expect(r.ok).toBe(false);
  });

  it('registry rejects an empty permissions array', () => {
    const r = validateManifest(makeTool({ permissions: [] }));
    expect(r.ok).toBe(false);
  });
});