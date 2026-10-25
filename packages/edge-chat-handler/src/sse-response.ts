// packages/edge-chat-handler/src/sse-response.ts
// PRD 7.7 SSE headers + streaming Response construction.
// The handler always returns status 200 once the stream begins — the SSE
// body itself carries any error (T-22: no 500 leaks after streaming starts).

import type { ChatEvent } from '@aura-lie/stream-proxy';
import { emitSse } from '@aura-lie/stream-proxy';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function sseResponseFromEvents(
  events: ChatEvent[],
  abortSignal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (abortSignal?.aborted) {
        controller.close();
        return;
      }
      try {
        for (const ev of events) {
          if (abortSignal?.aborted) break;
          controller.enqueue(encoder.encode(emitSse(ev)));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: SSE_HEADERS,
  });
}

export function jsonError(
  status: number,
  error: string,
  hint?: string,
): Response {
  return new Response(
    JSON.stringify({ error, hint }),
    {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}