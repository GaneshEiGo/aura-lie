// === FILE START ===
// packages/autonomy/src/permission-matrix.ts
// PRD §10.3 · FR-AGENT-04 · FR-SEC-03 · F-081 · T-31.
//
// The full RESOURCE × {READ, WRITE, SEND, DELETE} matrix. Values are
// allow | ask | never. Enforced OUTSIDE the model — a model that requests a
// forbidden action never executes it.
//
// PRD exceptions, handled by PermissionContext:
//   · memory.write       — ask for S2, allow for S0/S1
//   · run-code.write     — ask once per session (becomes allow after)
//   · notifications-self.send — allow within caps, ask once cap is reached
//   · any 'ask' can be auto-approved for Level-3 action classes pre-listed
//     by the user (actionClassAllowList).

export type Permission = 'allow' | 'ask' | 'never';

export type Resource =
  | 'memory'
  | 'project-files'
  | 'web'
  | 'calendar'
  | 'tasks-notes'
  | 'notifications-self'
  | 'messages-others'
  | 'run-code'
  | 'email'
  | 'payments'
  | 'settings';

export type Action = 'read' | 'write' | 'send' | 'delete';

export const RESOURCES: readonly Resource[] = Object.freeze([
  'memory',
  'project-files',
  'web',
  'calendar',
  'tasks-notes',
  'notifications-self',
  'messages-others',
  'run-code',
  'email',
  'payments',
  'settings',
] as const);

export const ACTIONS: readonly Action[] = Object.freeze([
  'read', 'write', 'send', 'delete',
] as const);

export interface PermissionContext {
  sensitivity?: 'S0' | 'S1' | 'S2';
  /** Set true once the user has approved code execution this session. */
  sessionApprovalGranted?: boolean;
  /** Remaining note-send allowance for notifications-self.send. */
  notesRemaining?: number;
  /** Level-3 action classes the user pre-approved (e.g. 'create-file'). */
  actionClassAllowList?: ReadonlySet<string>;
  /** Action class of the current request (e.g. 'create-file'). */
  actionClass?: string;
}

// Base matrix — PRD §10.3. A dash in the PRD is treated as `never` because a
// request without a rule must be blocked, not silently allowed.
const BASE: Readonly<Record<Resource, Readonly<Record<Action, Permission>>>> = Object.freeze({
  'memory':             { read: 'allow', write: 'allow', send: 'never', delete: 'ask'   },
  'project-files':      { read: 'allow', write: 'allow', send: 'never', delete: 'ask'   },
  'web':                { read: 'allow', write: 'never', send: 'never', delete: 'never' },
  'calendar':           { read: 'allow', write: 'allow', send: 'never', delete: 'ask'   },
  'tasks-notes':        { read: 'allow', write: 'allow', send: 'never', delete: 'ask'   },
  'notifications-self': { read: 'never', write: 'never', send: 'allow', delete: 'never' },
  'messages-others':    { read: 'never', write: 'never', send: 'never', delete: 'never' },
  'run-code':           { read: 'never', write: 'ask',   send: 'never', delete: 'never' },
  'email':              { read: 'never', write: 'never', send: 'never', delete: 'never' },
  'payments':           { read: 'never', write: 'never', send: 'never', delete: 'never' },
  'settings':           { read: 'allow', write: 'ask',   send: 'never', delete: 'never' },
} as const);

export function getBasePermission(resource: Resource, action: Action): Permission {
  return BASE[resource][action];
}

export function checkPermission(
  resource: Resource,
  action: Action,
  ctx: PermissionContext = {},
): Permission {
  const base = getBasePermission(resource, action);
  if (base === 'never') return 'never'; // NEVER wins over everything

  if (resource === 'memory' && action === 'write' && ctx.sensitivity === 'S2') {
    return 'ask';
  }

  if (resource === 'run-code' && action === 'write') {
    return ctx.sessionApprovalGranted ? 'allow' : 'ask';
  }

  if (resource === 'notifications-self' && action === 'send') {
    if (typeof ctx.notesRemaining === 'number' && ctx.notesRemaining <= 0) {
      return 'ask';
    }
    return base; // allow within caps
  }

  if (
    base === 'ask' &&
    ctx.actionClass &&
    ctx.actionClassAllowList?.has(ctx.actionClass)
  ) {
    return 'allow';
  }

  return base;
}

export type Decision = 'execute' | 'require-approval' | 'block';

export function evaluatePermission(
  resource: Resource,
  action: Action,
  ctx: PermissionContext = {},
): Decision {
  const p = checkPermission(resource, action, ctx);
  if (p === 'allow') return 'execute';
  if (p === 'ask') return 'require-approval';
  return 'block';
}

export class PermissionDenied extends Error {
  readonly kind = 'PermissionDenied';
  constructor(
    public readonly resource: Resource,
    public readonly action: Action,
    public readonly decision: Decision,
  ) {
    super(
      `Permission ${decision} for ${resource}.${action}`,
    );
    this.name = 'PermissionDenied';
  }
}

export interface ToolRequest<R> {
  resource: Resource;
  action: Action;
  /** Optional action-class identifier for Level-3 allow-lists. */
  actionClass?: string;
  ctx?: PermissionContext;
  /** Set true if the caller holds a valid approval card for this action. */
  approvedByUser?: boolean;
  run: () => Promise<R> | R;
}

export type ToolOutcome<R> =
  | { executed: true; value: R }
  | {
      executed: false;
      reason: 'require-approval' | 'blocked';
      decision: Decision;
    };

/**
 * The ONLY safe way to run a tool. Checks the matrix BEFORE running `run`.
 * A `block` decision wins over `approvedByUser` — NEVER means NEVER.
 */
export async function enforcePermission<R>(
  req: ToolRequest<R>,
): Promise<ToolOutcome<R>> {
  const ctx: PermissionContext = {
    ...(req.ctx ?? {}),
    ...(req.actionClass ? { actionClass: req.actionClass } : {}),
  };
  const decision = evaluatePermission(req.resource, req.action, ctx);

  if (decision === 'block') {
    return { executed: false, reason: 'blocked', decision };
  }
  if (decision === 'require-approval' && !req.approvedByUser) {
    return { executed: false, reason: 'require-approval', decision };
  }
  const value = await req.run();
  return { executed: true, value };
}

/** Convenience: build a full matrix snapshot for settings UI. */
export function dumpMatrix(): ReadonlyArray<{
  resource: Resource;
  read: Permission;
  write: Permission;
  send: Permission;
  delete: Permission;
}> {
  return RESOURCES.map((r) => ({
    resource: r,
    read: BASE[r].read,
    write: BASE[r].write,
    send: BASE[r].send,
    delete: BASE[r].delete,
  }));
}
// === FILE END ===