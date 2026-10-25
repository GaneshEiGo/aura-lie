// packages/stream-proxy/src/proxy.ts
// PRD 13.4 request lifecycle: meta → provider events → done.
// Stream-through, byte-for-byte where it can be. Only control frames and
// the final usage frame are inspected (PRD 7.7, 13.3).

import type {
  ChatEvent,
  ChatRequest,
  ProviderAdapter,
  ProviderChatEvent,
  ProxyOptions,
  ProxyResult,
} from './types.js';
import { SUBREQUEST_HARD_CAP } from './budget.js';

/**
 * Runs one request through the adapter. Returns the full stream of ChatEvents
 * plus budget and byte accounting. The caller pipes `events` out over SSE
 * (via `emitSse`) or hands them to the UI.
 *
 * Guarantees enforced here:
 *   - The first event is always `meta` (PRD 7.7).
 *   - The last event is always `done` (PRD 7.7, PRD 13.4).
 *   - `done.costInr` is always 0 (Law L1).
 *   - Total subrequests never exceed `maxSubrequests` (default 50,
 *     PRD 13.3). When the pipeline would exceed it, we emit `continue`
 *     with a step token instead of crashing (PRD 13.7).
 */
export async function streamThrough(
  adapter: ProviderAdapter,
  req: ChatRequest,
  options: ProxyOptions,
): Promise<ProxyResult> {
  const clock = options.clock ?? { now: () => Date.now() };
  const start = clock.now();
  const budget = options.maxSubrequests ?? SUBREQUEST_HARD_CAP;

  const events: ChatEvent[] = [];
  let bytesIn = 0;
  let bytesOut = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let subrequestsUsed = 0;
  let exhausted = false;
  let errored = false;
  let finished = false;

  const push = (event: ChatEvent): void => {
    events.push(event);
    bytesOut += JSON.stringify(event).length;
  };

  // meta first (PRD 7.7).
  push({
    t: 'meta',
    v: 1,
    turnId: req.turnId,
    mode: req.mode,
    persona: options.meta.persona,
    route: options.meta.route,
    sensitivity: req.sensitivity,
    riskTier: options.meta.riskTier,
  });

  // Adapter call counts as the first subrequest.
  subrequestsUsed += 1;

  try {
    for await (const ev of adapter.chat(req)) {
      bytesIn += JSON.stringify(ev).length;

      if (subrequestsUsed >= budget) {
        exhausted = true;
        push({
          t: 'continue',
          stepToken: `continue-${req.turnId}-${subrequestsUsed}`,
          reason: `subrequest budget ${budget} exhausted (PRD 13.3); continue with a resumable step`,
        });
        break;
      }

      switch (ev.kind) {
        case 'reasoning':
          push({
            t: 'thinking',
            delta: ev.delta,
            provider: ev.provider,
            model: ev.model,
            kind: ev.format,
          });
          break;

        case 'content':
          push({ t: 'token', delta: ev.delta });
          break;

        case 'usage':
          promptTokens += ev.promptTokens;
          completionTokens += ev.completionTokens;
          break;

        case 'rateLimit':
          push({
            t: 'quota',
            pools: [
              {
                pool: adapter.id,
                used: 0,
                planningLimit: 0,
                resetsAt: ev.resetsAt,
              },
            ],
          });
          break;

        case 'finish':
          if (ev.reason === 'error') {
            errored = true;
            push({
              t: 'error',
              code: ev.errorCode ?? 'provider_error',
              userMessage: 'The model returned an error. Try again.',
              retryHint: 'Retry on another model?',
            });
          }
          finished = true;
          break;

        case 'subrequest':
          subrequestsUsed += ev.cost;
          break;
      }

      if (finished) break;
    }
  } catch (err) {
    errored = true;
    push({
      t: 'error',
      code: 'adapter_threw',
      userMessage:
        err instanceof Error
          ? err.message
          : 'The provider adapter failed unexpectedly.',
      retryHint: 'Retry on another model?',
    });
  }

  if (!finished && !errored && !exhausted) {
    push({
      t: 'notice',
      severity: 'warn',
      code: 'stream_ended_without_finish',
      text: 'Provider stream ended without a finish frame.',
    });
  }

  const durationMs = clock.now() - start;
  const totalTokens = promptTokens + completionTokens;

  push({
    t: 'done',
    elapsedMs: durationMs,
    calls: 1,
    tokens: totalTokens,
    costInr: 0,
  });

  return {
    turnId: req.turnId,
    events,
    bytesIn,
    bytesOut,
    promptTokens,
    completionTokens,
    subrequestsUsed,
    subrequestsBudget: budget,
    exhausted,
    errored,
    durationMs,
  };
}