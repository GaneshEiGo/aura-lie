// packages/tools-runner/src/types.ts
// PRD 12.1, FR-TOOL-04, FR-SEC-05.

import type { EnforceContext } from '@aura-lie/permission-tools';

/**
 * Audit sink — duck-typed to match `HashChainedAuditLog` from
 * @aura-lie/kill-switch-audit without requiring it as a hard dependency.
 */
export interface AuditSink {
  record(input: {
    action: 'tool_call' | 'tool_blocked';
    actor: string;
    reason: string;
    tool?: string;
    result?: 'success' | 'failure' | 'blocked';
    outputSummary?: string;
    inputPayload?: unknown;
  }): unknown;
}

/** Everything a tool executor needs to know about the turn. */
export interface ExecutionContext {
  turnId: string;
  actor: string;
  permission: EnforceContext;
  audit?: AuditSink;
}

/** PRD 12.1: one executor per tool id. */
export type ToolExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: ExecutionContext,
) => Promise<TOutput> | TOutput;

export type ExecutorMap = Record<string, ToolExecutor>;

export interface SandboxOptions {
  timeoutMs: number;
}

export interface SandboxResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ToolRunResult {
  toolId: string;
  allowed: boolean;
  requiresApproval: boolean;
  fencedOutput?: string;
  rawOutput?: unknown;
  redacted: boolean;
  bytesEmitted: number;
  durationMs: number;
  error?: string;
}

export class SandboxTimeoutError extends Error {
  constructor(ms: number) {
    super(`tool timed out after ${ms}ms (FR-TOOL-04)`);
    this.name = 'SandboxTimeoutError';
  }
}