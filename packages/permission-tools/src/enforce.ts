// packages/permission-tools/src/enforce.ts
// PRD 10.3, 10.9, 12.4, FR-SEC-03, FR-TOOL-08.
// Every tool call passes through `enforce` — the model cannot bypass it.

import type {
  DryRunSummary,
  EnforceContext,
  EnforceResult,
  PermissionCheck,
  PermissionClass,
  Resource,
  ToolManifest,
} from './types.js';
import { HARMLESS_WRITE_RESOURCES, VALID_PERMISSION_CLASSES } from './types.js';
import { lookupMatrix } from './matrix.js';

// ---------------------------------------------------------------------------
// enforce — the single server-side gate
// ---------------------------------------------------------------------------

export function enforce(
  tool: ToolManifest,
  ctx: EnforceContext,
): EnforceResult {
  const checks: PermissionCheck[] = [];
  let blockedBy: string | undefined;

  for (const permission of tool.permissions) {
    const check = evaluateOnePermission(permission, ctx);
    checks.push(check);
    if (
      !blockedBy &&
      (check.decision === 'never' || check.decision === 'not_built')
    ) {
      blockedBy = permission;
    }
  }

  const dryRun = summarizeForDryRun(tool, checks);

  if (blockedBy) {
    return {
      tool: tool.id,
      checks,
      allowed: false,
      requiresApproval: false,
      requiresConfirmation: false,
      blockedBy,
      noExternalActions: true,
      dryRun,
    };
  }

  const requiresApproval = checks.some((c) => c.decision === 'ask');
  return {
    tool: tool.id,
    checks,
    allowed: true,
    requiresApproval,
    requiresConfirmation: requiresApproval,
    noExternalActions: true,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// approve — record session-level approvals after the user confirms
// ---------------------------------------------------------------------------

export function approveApprovals(
  result: EnforceResult,
  ctx: EnforceContext,
): void {
  for (const check of result.checks) {
    if (check.decision !== 'ask') continue;
    const cell = lookupMatrix(check.resource, check.cls);
    if (cell.askOncePerSession) {
      ctx.session.approve(`${check.resource}.${check.cls}`);
    }
  }
}

// ---------------------------------------------------------------------------
// dryRun — FR-TOOL-08 explicit dry-run
// ---------------------------------------------------------------------------

export function dryRun(
  tool: ToolManifest,
  ctx: EnforceContext,
): EnforceResult {
  return enforce(tool, ctx);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function evaluateOnePermission(
  permission: string,
  ctx: EnforceContext,
): PermissionCheck {
  const parsed = parsePermission(permission);
  if (!parsed) {
    return {
      permission,
      cls: 'read',
      resource: 'web',
      decision: 'never',
      requiresApproval: false,
      reason: 'invalid permission format',
    };
  }
  const { cls, resource } = parsed;
  const cell = lookupMatrix(resource, cls);
  let decision = cell.decision;
  let reason = `matrix: ${resource}.${cls} = ${decision}`;

  // PRD 9.5: S2 memory writes need explicit approval.
  if (cell.s2RequiresAsk && ctx.sensitivity === 'S2' && decision === 'allow') {
    decision = 'ask';
    reason = 'S2 memory write requires explicit approval (PRD 9.5)';
  }

  // PRD 10.9: harmless writes at Level 2+ run without asking.
  if (
    decision === 'allow' &&
    cls === 'write' &&
    HARMLESS_WRITE_RESOURCES.includes(resource) &&
    ctx.level < 2
  ) {
    decision = 'ask';
    reason = `harmless write at Level ${ctx.level} asks (PRD 10.9)`;
  }

  // PRD 12.4: tainted turn forces approval for write/send/delete, any level.
  if (
    ctx.tainted &&
    (cls === 'write' || cls === 'send' || cls === 'delete') &&
    decision === 'allow'
  ) {
    decision = 'ask';
    reason = 'tainted turn requires confirmation (PRD 12.4)';
  }

  // PRD 10.3: "ask once per session" — if the user already approved, allow.
  if (decision === 'ask' && cell.askOncePerSession) {
    const key = `${resource}.${cls}`;
    if (ctx.session.has(key)) {
      decision = 'allow';
      reason = `${key} already approved this session (PRD 10.3)`;
    }
  }

  return {
    permission,
    cls,
    resource,
    decision,
    requiresApproval: decision === 'ask',
    reason,
  };
}

export function parsePermission(
  perm: string,
): { cls: PermissionClass; resource: Resource } | null {
  if (typeof perm !== 'string') return null;
  const idx = perm.indexOf(':');
  if (idx <= 0 || idx === perm.length - 1) return null;
  const cls = perm.slice(0, idx);
  const resource = perm.slice(idx + 1);
  if (!VALID_PERMISSION_CLASSES.includes(cls as PermissionClass)) return null;
  return {
    cls: cls as PermissionClass,
    resource: resource as Resource,
  };
}

function summarizeForDryRun(
  tool: ToolManifest,
  checks: PermissionCheck[],
): DryRunSummary {
  const s: DryRunSummary = {
    wouldRead: false,
    wouldWrite: false,
    wouldSend: false,
    wouldDelete: false,
    wouldExecute: false,
    quotaPool: tool.quotaPool,
    estimatedRisk: tool.risk,
  };
  for (const c of checks) {
    switch (c.cls) {
      case 'read':
        s.wouldRead = true;
        break;
      case 'write':
        s.wouldWrite = true;
        break;
      case 'send':
        s.wouldSend = true;
        break;
      case 'delete':
        s.wouldDelete = true;
        break;
      case 'execute':
        s.wouldExecute = true;
        break;
    }
  }
  return s;
}