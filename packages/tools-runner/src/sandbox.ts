// packages/tools-runner/src/sandbox.ts
// FR-TOOL-04 + PRD 3.2 #9: time-boxed execution. Wall-clock timer races
// against the tool function. Real Workers get the same contract.

import type { SandboxOptions, SandboxResult } from './types.js';
import { SandboxTimeoutError } from './types.js';

/**
 * Run `fn` with a wall-clock timeout. If `fn` throws (sync or async), the
 * error is captured in the result. The elapsed time is always reported.
 */
export async function runInSandbox<T>(
  fn: () => Promise<T> | T,
  options: SandboxOptions,
): Promise<SandboxResult<T>> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      ok: false,
      error: `invalid timeoutMs: ${timeoutMs}`,
      durationMs: 0,
      timedOut: false,
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SandboxTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  // Defer the fn call to a microtask so a synchronous throw is captured.
  const fnPromise = Promise.resolve().then(() => fn());

  try {
    const value = await Promise.race([fnPromise, timeoutPromise]);
    if (timer !== null) clearTimeout(timer);
    return {
      ok: true,
      value,
      durationMs: Date.now() - started,
      timedOut: false,
    };
  } catch (err) {
    if (timer !== null) clearTimeout(timer);
    const timedOut = err instanceof SandboxTimeoutError;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
      timedOut,
    };
  }
}