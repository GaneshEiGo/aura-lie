// apps/edge/src/adapters/mock.ts
// Deterministic mock adapter for tests and zero-key start (PRD F-253).

import type {
  ProviderAdapter,
  ProviderChatEvent,
} from '@aura-lie/stream-proxy';

export interface MockAdapterOptions {
  id?: string;
  lane?: 'private' | 'training-risk';
  events?: ProviderChatEvent[];
  delayMs?: number;
}

export function createMockAdapter(
  options: MockAdapterOptions = {},
): ProviderAdapter {
  const defaultEvents: ProviderChatEvent[] = [
    { kind: 'content', delta: 'Hello' },
    { kind: 'content', delta: ' from the mock adapter.' },
    { kind: 'usage', promptTokens: 8, completionTokens: 5 },
    { kind: 'finish', reason: 'stop' },
  ];
  return {
    id: options.id ?? 'mock',
    lane: options.lane ?? 'private',
    async *chat() {
      const events = options.events ?? defaultEvents;
      for (const event of events) {
        if (options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        yield event;
      }
    },
  };
}