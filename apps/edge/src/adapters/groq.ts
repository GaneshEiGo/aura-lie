// apps/edge/src/adapters/groq.ts
// PRD 4.1: Groq is a private lane provider (subject to [VERIFY] at signup).
// Uses guardedFetch (Section 54) so billing/upgrade paths are unreachable.

import { guardedFetch, buildDefaultPolicy } from '@aura-lie/cost-guard';
import { parseSseChunk } from '@aura-lie/stream-proxy';
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderChatEvent,
} from '@aura-lie/stream-proxy';
import type { CommonAdapterOptions } from './types.js';

export function createGroqAdapter(
  options: CommonAdapterOptions,
): ProviderAdapter {
  const policy = buildDefaultPolicy();
  return {
    id: 'groq',
    lane: 'private',
    async *chat(req: ChatRequest): AsyncIterable<ProviderChatEvent> {
      const body = {
        model: req.model || options.defaultModel || 'llama-3.3-70b-versatile',
        messages: req.messages,
        stream: true,
        max_tokens: req.maxTokens,
      };

      let res: Response;
      try {
        res = await guardedFetch(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify(body),
          },
          policy,
          { fetchImpl: options.fetchImpl, adapter: 'groq' },
        );
      } catch (err) {
        yield {
          kind: 'finish',
          reason: 'error',
          errorCode: err instanceof Error ? err.message : 'groq_fetch_failed',
        };
        return;
      }

      if (!res.ok || !res.body) {
        yield {
          kind: 'finish',
          reason: 'error',
          errorCode: `groq_${res.status}`,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.trim()) continue;
            for (const frame of parseSseChunk(part + '\n\n')) {
              if (frame.data === '[DONE]') {
                yield { kind: 'finish', reason: 'stop' };
                finished = true;
                break;
              }
              try {
                const parsed = JSON.parse(frame.data);
                const delta = parsed?.choices?.[0]?.delta;
                if (delta?.content) {
                  yield { kind: 'content', delta: delta.content };
                }
                if (delta?.reasoning || delta?.reasoning_content) {
                  yield {
                    kind: 'reasoning',
                    delta: delta.reasoning ?? delta.reasoning_content,
                    provider: 'groq',
                    model: req.model,
                    format: 'raw',
                  };
                }
                if (parsed?.usage) {
                  yield {
                    kind: 'usage',
                    promptTokens: parsed.usage.prompt_tokens ?? 0,
                    completionTokens: parsed.usage.completion_tokens ?? 0,
                  };
                }
              } catch {
                /* skip malformed frames */
              }
            }
            if (finished) break;
          }
        }
      } finally {
        reader.releaseLock?.();
      }

      if (!finished) {
        yield { kind: 'finish', reason: 'stop' };
      }
    },
  };
}