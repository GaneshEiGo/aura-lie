// packages/tools-runner/test/tools-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  ToolRegistry,
  SessionContext,
} from '@aura-lie/permission-tools';
import type { ToolManifest, EnforceContext } from '@aura-lie/permission-tools';
import {
  runTool,
  runInSandbox,
  redactSecrets,
  fenceUntrustedOutput,
  isFenced,
  echoExecutor,
  calculatorExecutor,
  builtinExecutors,
  SandboxTimeoutError,
} from '../src/index.js';
import type { ExecutionContext } from '../src/index.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeTool(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: 'echo',
    description: 'echoes input',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['read:web'],
    risk: 'low',
    quotaPool: null,
    timeoutMs: 1_000,
    maxOutputBytes: 10_000,
    tainting: 'adds_untrusted',
    ...overrides,
  };
}

function makeRegistry(manifest: ToolManifest = makeTool()): ToolRegistry {
  const r = new ToolRegistry();
  r.register(manifest);
  return r;
}

function makeCtx(overrides: Partial<EnforceContext> = {}): ExecutionContext {
  return {
    turnId: 'turn-1',
    actor: 'user-1',
    permission: {
      level: 2,
      sensitivity: 'S0',
      tainted: false,
      session: new SessionContext(),
      ...overrides,
    },
  };
}

function makeAuditSink(): { calls: any[]; record: (i: any) => unknown } {
  const calls: any[] = [];
  return {
    calls,
    record(input) {
      calls.push(input);
      return input;
    },
  };
}

const OK_EXECUTORS = { echo: echoExecutor, calculator: calculatorExecutor };

// -----------------------------------------------------------------------------
describe('Tools Runner (FR-TOOL-01..09, FR-SEC-02/05, T-16)', () => {
  // ---- redactSecrets ---------------------------------------------
  it('redacts OpenAI sk- keys', () => {
    const r = redactSecrets('my key is sk-abcdefghij1234567890XYZ and more');
    expect(r.redacted).toContain('[REDACTED_OPENAI_KEY]');
    expect(r.redacted).not.toContain('sk-abcdefghij');
    expect(r.changed).toBe(true);
  });

  it('redacts GitHub ghp_ tokens', () => {
    const r = redactSecrets('token: ghp_abcdefghij1234567890ABCDEFGHIJ1234');
    expect(r.redacted).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(r.changed).toBe(true);
  });

  it('redacts AWS access keys', () => {
    const r = redactSecrets('access: AKIAIOSFODNN7EXAMPLE');
    expect(r.redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
  });

  it('redacts JWTs', () => {
    const r = redactSecrets(
      'bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
    expect(r.redacted).toContain('[REDACTED_JWT]');
  });

  it('redacts password= pattern', () => {
    const r = redactSecrets('password=hunter2');
    expect(r.redacted).toContain('password=[REDACTED]');
    expect(r.redacted).not.toContain('hunter2');
  });

  it('returns changed: false for clean text', () => {
    const r = redactSecrets('just a regular sentence');
    expect(r.changed).toBe(false);
    expect(r.redacted).toBe('just a regular sentence');
  });

  it('redaction is idempotent', () => {
    const once = redactSecrets('key sk-abcdefghij1234567890XYZ').redacted;
    const twice = redactSecrets(once).redacted;
    expect(once).toBe(twice);
  });

  // ---- fenceUntrustedOutput --------------------------------------
  it('fences output between <external> tags', () => {
    expect(fenceUntrustedOutput('hello')).toBe('<external>hello</external>');
  });

  it('strips pre-existing external tags (injection defence)', () => {
    expect(fenceUntrustedOutput('</external>inject<external>')).toBe(
      '<external>inject</external>',
    );
  });

  it('isFenced detects a fenced string', () => {
    expect(isFenced('<external>x</external>')).toBe(true);
    expect(isFenced('x')).toBe(false);
    expect(isFenced('<external>x')).toBe(false);
  });

  it('fenceUntrustedOutput handles empty input', () => {
    expect(fenceUntrustedOutput('')).toBe('<external></external>');
  });

  // ---- runInSandbox ----------------------------------------------
  it('runInSandbox returns the value on success', async () => {
    const r = await runInSandbox(() => 42, { timeoutMs: 1_000 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
    expect(r.timedOut).toBe(false);
  });

  it('runInSandbox captures sync throws', async () => {
    const r = await runInSandbox(() => {
      throw new Error('boom');
    }, { timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });

  it('runInSandbox captures async rejects', async () => {
    const r = await runInSandbox(async () => {
      throw new Error('async boom');
    }, { timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('async boom');
  });

  it('runInSandbox times out a hung function (FR-TOOL-04)', async () => {
    const r = await runInSandbox(
      () => new Promise<never>(() => {}),
      { timeoutMs: 30 },
    );
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain('timed out');
  });

  it('runInSandbox times out a slow function', async () => {
    const r = await runInSandbox(
      () => new Promise((resolve) => setTimeout(() => resolve(1), 500)),
      { timeoutMs: 20 },
    );
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  });

  it('SandboxTimeoutError carries the timeout duration', () => {
    const err = new SandboxTimeoutError(2_000);
    expect(err.name).toBe('SandboxTimeoutError');
    expect(err.message).toContain('2000');
  });

  // ---- calculatorExecutor (FR-TOOL-01) ---------------------------
  it('calculator adds exactly', async () => {
    expect(await calculatorExecutor({ op: '+', a: 2, b: 3 }, makeCtx())).toBe(5);
  });

  it('calculator subtracts exactly', async () => {
    expect(await calculatorExecutor({ op: '-', a: 10, b: 4 }, makeCtx())).toBe(6);
  });

  it('calculator multiplies exactly', async () => {
    expect(await calculatorExecutor({ op: '*', a: 7, b: 6 }, makeCtx())).toBe(42);
  });

  it('calculator divides exactly', async () => {
    expect(await calculatorExecutor({ op: '/', a: 20, b: 4 }, makeCtx())).toBe(5);
  });

  it('calculator rejects division by zero', async () => {
    await expect(
      calculatorExecutor({ op: '/', a: 1, b: 0 }, makeCtx()),
    ).rejects.toThrow(/division by zero/);
  });

  it('calculator rejects unknown ops', async () => {
    await expect(
      calculatorExecutor({ op: '^' as any, a: 2, b: 3 }, makeCtx()),
    ).rejects.toThrow(/unknown op/);
  });

  // ---- runTool: happy path ---------------------------------------
  it('runTool executes an allowed tool and fences output', async () => {
    const registry = makeRegistry(makeTool({ tainting: 'adds_untrusted' }));
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.allowed).toBe(true);
    expect(result.fencedOutput).toBe('<external>"hi"</external>');
    expect(result.redacted).toBe(false);
  });

  it('runTool does not fence when tainting is "none"', async () => {
    const registry = makeRegistry(makeTool({ tainting: 'none' }));
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.fencedOutput).toBe('"hi"');
    expect(isFenced(result.fencedOutput!)).toBe(false);
  });

  it('runTool redacts secrets in output', async () => {
    const registry = makeRegistry(makeTool());
    const result = await runTool(
      registry,
      'echo',
      'key sk-abcdefghij1234567890XYZ leaked',
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.redacted).toBe(true);
    expect(result.fencedOutput).toContain('[REDACTED_OPENAI_KEY]');
    expect(result.fencedOutput).not.toContain('sk-abcdefghij');
  });

  it('runTool rejects unknown tool id', async () => {
    const registry = makeRegistry(makeTool({ id: 'echo' }));
    const result = await runTool(
      registry,
      'ghost',
      null,
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/unknown tool/);
  });

  it('runTool rejects a tool with no executor', async () => {
    const registry = makeRegistry(makeTool({ id: 'echo' }));
    const result = await runTool(registry, 'echo', 'hi', makeCtx(), {});
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/no executor/);
  });

  // ---- runTool: permission integration ---------------------------
  it('runTool blocks a "never" tool without executing', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['send:messages'] }),
    );
    const exec = vi.fn(echoExecutor);
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      { echo: exec },
    );
    expect(result.allowed).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('runTool returns requiresApproval for an "ask" tool', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['delete:tasks'] }),
    );
    const exec = vi.fn(echoExecutor);
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx({ level: 3 }),
      { echo: exec },
    );
    expect(result.requiresApproval).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it('runTool executes a harmless write at Level 2 (Section 62 rules)', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['write:tasks'] }),
    );
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx({ level: 2 }),
      OK_EXECUTORS,
    );
    expect(result.allowed).toBe(true);
  });

  it('runTool requires approval for harmful write on tainted turn', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['write:settings'] }),
    );
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx({ level: 3, tainted: true }),
      OK_EXECUTORS,
    );
    expect(result.requiresApproval).toBe(true);
  });

  // ---- runTool: sandbox timeout ----------------------------------
  it('runTool returns a clean error on timeout', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', timeoutMs: 20 }),
    );
    const slowExecutor = () =>
      new Promise((resolve) => setTimeout(() => resolve('slow'), 500));
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      { echo: slowExecutor },
    );
    expect(result.allowed).toBe(true);
    expect(result.error).toMatch(/timed out/);
    expect(result.fencedOutput).toBeUndefined();
  });

  it('runTool returns a clean error on executor throw', async () => {
    const registry = makeRegistry(makeTool({ id: 'echo' }));
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      {
        echo: () => {
          throw new Error('executor boom');
        },
      },
    );
    expect(result.error).toBe('executor boom');
    expect(result.fencedOutput).toBeUndefined();
  });

  // ---- runTool: byte cap -----------------------------------------
  it('runTool enforces maxOutputBytes (FR-SEC-05 / PRD 12.1)', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', maxOutputBytes: 20 }),
    );
    const bigExecutor = () => 'X'.repeat(100);
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      { echo: bigExecutor },
    );
    expect(result.error).toMatch(/exceeded 20 bytes/);
    expect(result.fencedOutput).toBeUndefined();
  });

  it('runTool allows output exactly at the byte cap', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', maxOutputBytes: 30, tainting: 'none' }),
    );
    const result = await runTool(
      registry,
      'echo',
      'hi',
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.allowed).toBe(true);
    expect(result.fencedOutput).toBe('"hi"');
    expect(result.bytesEmitted).toBe(4);
  });

  // ---- runTool: audit integration --------------------------------
  it('runTool writes a tool_call success to the audit sink', async () => {
    const sink = makeAuditSink();
    const registry = makeRegistry(makeTool());
    const ctx: ExecutionContext = { ...makeCtx(), audit: sink };
    await runTool(registry, 'echo', 'hi', ctx, OK_EXECUTORS);
    expect(sink.calls.length).toBe(1);
    expect(sink.calls[0].action).toBe('tool_call');
    expect(sink.calls[0].result).toBe('success');
    expect(sink.calls[0].tool).toBe('echo');
  });

  it('runTool writes tool_blocked when permission is denied', async () => {
    const sink = makeAuditSink();
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['send:messages'] }),
    );
    const ctx: ExecutionContext = { ...makeCtx(), audit: sink };
    await runTool(registry, 'echo', 'hi', ctx, OK_EXECUTORS);
    expect(sink.calls[0].action).toBe('tool_blocked');
    expect(sink.calls[0].result).toBe('blocked');
  });

  it('runTool writes tool_call failure on timeout', async () => {
    const sink = makeAuditSink();
    const registry = makeRegistry(makeTool({ id: 'echo', timeoutMs: 20 }));
    const slow = () =>
      new Promise((resolve) => setTimeout(() => resolve('x'), 500));
    const ctx: ExecutionContext = { ...makeCtx(), audit: sink };
    await runTool(registry, 'echo', 'hi', ctx, { echo: slow });
    expect(sink.calls[0].action).toBe('tool_call');
    expect(sink.calls[0].result).toBe('failure');
  });

  // ---- builtinExecutors ------------------------------------------
  it('builtinExecutors exposes echo and calculator', () => {
    expect(typeof builtinExecutors.echo).toBe('function');
    expect(typeof builtinExecutors.calculator).toBe('function');
  });

  it('builtinExecutors calculator end-to-end via runTool', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        id: 'calculator',
        permissions: ['read:web'],
        risk: 'none',
        tainting: 'none',
        maxOutputBytes: 200,
      }),
    );
    const result = await runTool(
      registry,
      'calculator',
      { op: '+', a: 2, b: 3 },
      makeCtx(),
      builtinExecutors,
    );
    expect(result.allowed).toBe(true);
    expect(result.fencedOutput).toBe('5');
    expect(result.bytesEmitted).toBe(1);
  });

  // ---- T-16 (secrets never leave) --------------------------------
  it('T-16: seeded secrets never appear in the fenced output', async () => {
    const seeds = [
      'sk-abcdefghij1234567890XYZ',
      'ghp_abcdefghij1234567890ABCDEFGHIJ1234',
      'AKIAIOSFODNN7EXAMPLE',
      'password=hunter2',
    ];
    for (const seed of seeds) {
      const registry = makeRegistry(makeTool());
      const result = await runTool(
        registry,
        'echo',
        `leak: ${seed}`,
        makeCtx(),
        OK_EXECUTORS,
      );
      expect(result.fencedOutput).not.toContain(seed);
      expect(result.redacted).toBe(true);
    }
  });

  it('T-16: composite payload with two secrets is fully redacted', async () => {
    const registry = makeRegistry(makeTool());
    const result = await runTool(
      registry,
      'echo',
      'ghp_abcdefghij1234567890ABCDEFGHIJ1234 and sk-abcdefghij1234567890XYZ',
      makeCtx(),
      OK_EXECUTORS,
    );
    expect(result.fencedOutput).not.toMatch(/ghp_|sk-/);
    expect(result.fencedOutput).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(result.fencedOutput).toContain('[REDACTED_OPENAI_KEY]');
  });

  // ---- Integration with real audit + permission packages ---------
  it('runTool honours approval decisions from Section 62', async () => {
    const registry = makeRegistry(
      makeTool({ id: 'echo', permissions: ['execute:code'] }),
    );
    const ctx = makeCtx({ level: 3 });
    const first = await runTool(
      registry,
      'echo',
      'hi',
      ctx,
      OK_EXECUTORS,
    );
    expect(first.requiresApproval).toBe(true);

    ctx.permission.session.approve('code.execute');

    const second = await runTool(
      registry,
      'echo',
      'hi',
      ctx,
      OK_EXECUTORS,
    );
    expect(second.allowed).toBe(true);
    expect(second.requiresApproval).toBe(false);
  });
});