// packages/tools-runner/src/runner.ts
// The single execution path. enforce → sandbox → redact → fence → audit.

import { enforce } from '@aura-lie/permission-tools';
import type { ToolManifest, ToolRegistry } from '@aura-lie/permission-tools';
import type {
  AuditSink,
  ExecutionContext,
  ExecutorMap,
  ToolRunResult,
} from './types.js';
import { runInSandbox } from './sandbox.js';
import { redactSecrets } from './redact.js';
import { fenceUntrustedOutput } from './fence.js';

export async function runTool(
  registry: ToolRegistry,
  toolId: string,
  input: unknown,
  ctx: ExecutionContext,
  executors: ExecutorMap,
): Promise<ToolRunResult> {
  const started = Date.now();

  const tool = registry.get(toolId);
  if (!tool) {
    return fail(toolId, started, 'unknown tool');
  }

  // 1. Enforce the permission matrix (Section 62).
  const verdict = enforce(tool, ctx.permission);
  if (!verdict.allowed) {
    auditBlocked(ctx, tool, verdict.blockedBy ?? 'denied');
    return fail(toolId, started, `blocked: ${verdict.blockedBy ?? 'denied'}`);
  }
  if (verdict.requiresApproval) {
    auditBlocked(ctx, tool, 'requires approval');
    return {
      toolId,
      allowed: false,
      requiresApproval: true,
      redacted: false,
      bytesEmitted: 0,
      durationMs: Date.now() - started,
      error: 'requires approval',
    };
  }

  // 2. Find the executor.
  const executor = executors[toolId];
  if (!executor) {
    return fail(toolId, started, 'no executor registered');
  }

  // 3. Run in the sandbox (wall-clock timeout).
  const sandbox = await runInSandbox(
    () => executor(input, ctx),
    { timeoutMs: tool.timeoutMs },
  );

  if (!sandbox.ok) {
    auditFailure(ctx, tool, sandbox.error ?? 'unknown sandbox error');
    return {
      toolId,
      allowed: true,
      requiresApproval: false,
      redacted: false,
      bytesEmitted: 0,
      durationMs: sandbox.durationMs,
      error: sandbox.error ?? 'sandbox failed',
    };
  }

  // 4. Serialize the raw output to a canonical JSON string.
  //    ALWAYS use JSON.stringify — even for strings — so that the wire
  //    representation is deterministic (`'hi'` → `"hi"`, `5` → `5`,
  //    `undefined` → `null`). This is the contract the tests and the
  //    fence/redact layers depend on.
  const rawText = serializeValue(sandbox.value);

  // 5. Redact secrets BEFORE anything else (FR-SEC-05).
  const redaction = redactSecrets(rawText);

  // 6. Fence if the manifest says it adds untrusted content (PRD 12.4).
  const emitted =
    tool.tainting === 'adds_untrusted'
      ? fenceUntrustedOutput(redaction.redacted)
      : redaction.redacted;

  // 7. Enforce the output cap (PRD 12.1).
  const byteLength = new TextEncoder().encode(emitted).length;
  if (byteLength > tool.maxOutputBytes) {
    auditFailure(
      ctx,
      tool,
      `output exceeded ${tool.maxOutputBytes} bytes`,
    );
    return {
      toolId,
      allowed: true,
      requiresApproval: false,
      redacted: redaction.changed,
      bytesEmitted: 0,
      durationMs: sandbox.durationMs,
      error: `output exceeded ${tool.maxOutputBytes} bytes`,
    };
  }

  // 8. Audit success.
  auditSuccess(ctx, tool, sandbox.durationMs, redaction.changed);

  return {
    toolId,
    allowed: true,
    requiresApproval: false,
    fencedOutput: emitted,
    rawOutput: sandbox.value,
    redacted: redaction.changed,
    bytesEmitted: byteLength,
    durationMs: sandbox.durationMs,
  };
}

/**
 * Canonical serialization of any tool output.
 *   - undefined → 'null'
 *   - string 'hi' → '"hi"'
 *   - number 5 → '5'
 *   - object {a:1} → '{"a":1}'
 *   - null → 'null'
 *   - NaN / Infinity → 'null' (JSON.stringify semantics)
 */
function serializeValue(value: unknown): string {
  if (typeof value === 'undefined') return 'null';
  const json = JSON.stringify(value);
  return typeof json === 'string' ? json : 'null';
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

function auditSuccess(
  ctx: ExecutionContext,
  tool: ToolManifest,
  durationMs: number,
  redacted: boolean,
): void {
  ctx.audit?.record({
    action: 'tool_call',
    actor: ctx.actor,
    reason: `executed ${tool.id} in ${durationMs}ms`,
    tool: tool.id,
    result: 'success',
    outputSummary: redacted
      ? 'output redacted before returning to model'
      : 'output returned unredacted',
  });
}

function auditFailure(
  ctx: ExecutionContext,
  tool: ToolManifest,
  reason: string,
): void {
  ctx.audit?.record({
    action: 'tool_call',
    actor: ctx.actor,
    reason,
    tool: tool.id,
    result: 'failure',
  });
}

function auditBlocked(
  ctx: ExecutionContext,
  tool: ToolManifest,
  reason: string,
): void {
  ctx.audit?.record({
    action: 'tool_blocked',
    actor: ctx.actor,
    reason,
    tool: tool.id,
    result: 'blocked',
  });
}

function fail(toolId: string, startedAt: number, error: string): ToolRunResult {
  return {
    toolId,
    allowed: false,
    requiresApproval: false,
    redacted: false,
    bytesEmitted: 0,
    durationMs: Date.now() - startedAt,
    error,
  };
}

export type { AuditSink, ExecutionContext, ExecutorMap } from './types.js';