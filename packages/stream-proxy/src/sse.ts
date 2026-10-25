// packages/stream-proxy/src/sse.ts
// PRD 7.7: "One SSE stream per turn. In stream-through mode the Worker
// forwards provider bytes and parses only control frames and the final
// usage frame."

import type { ChatEvent } from './types.js';

export interface SseFrame {
  event?: string;
  data: string;
}

/**
 * Split a raw SSE chunk into typed frames. Handles multi-data-line frames
 * (`data:` appearing more than once) per the WHATWG SSE spec. Never throws.
 */
export function parseSseChunk(raw: string): SseFrame[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  const frames: SseFrame[] = [];
  const blocks = raw.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') });
    }
  }

  return frames;
}

/**
 * Serialize a single ChatEvent into one SSE frame with the event type set
 * to `t` (Appendix C uses `t` as the discriminator).
 */
export function emitSse(event: ChatEvent): string {
  return `event: ${event.t}\ndata: ${JSON.stringify(event)}\n\n`;
}