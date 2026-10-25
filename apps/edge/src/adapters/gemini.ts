// apps/edge/src/adapters/gemini.ts
// PRD 4.1: Gemini free tier = training-risk lane.

import { guardedFetch, buildDefaultPolicy } from '@aura-lie/cost-guard';
import { parseSseChunk } from '@aura-lie/stream-proxy';
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderChatEvent,
} from '@aura-lie/stream-proxy';
import type { CommonAdapterOptions } from './types.js';

export function createGeminiAdapter(
  options: CommonAdapterOptions,
): ProviderAdapter {
  const policy = buildDefaultPolicy();
  return {
    id: 'gemini',
    lane: 'training-risk',
    async *chat(req: ChatRequest): AsyncIterable<ProviderChatEvent> {
      const contents = req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = {
        contents,
        generationConfig: {
          maxOutputTokens: req.maxTokens,
        },
      };
      const model =
        req.model || options.defaultModel || 'gemini-2-flash';
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:streamGenerateContent` +
        `?alt=sse&key=${encodeURIComponent(options.apiKey)}`;

      let res: Response;
      try {
        res = await guardedFetch(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          policy,
          { fetchImpl: options.fetchImpl, adapter: 'gemini' },
        );
      } catch (err) {
        yield {
          kind: 'finish',
          reason: 'error',
          errorCode: err instanceof Error ? err.message : 'gemini_fetch_failed',
        };
        return;
      }

      if (!res.ok || !res.body) {
        yield {
          kind: 'finish',
          reason: 'error',
          errorCode: `gemini_${res.status}`,
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
              try {
                const parsed = JSON.parse(frame.data);
                const candidate = parsed?.candidates?.[0];
                const text = candidate?.content?.parts?.[0]?.text;
                if (text) yield { kind: 'content', delta: text };
                if (parsed?.usageMetadata) {
                  yield {
                    kind: 'usage',
                    promptTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                    completionTokens:
                      parsed.usageMetadata.candidatesTokenCount ?? 0,
                  };
                }
                const finishReason = candidate?.finishReason;
                if (finishReason) {
                  if (finishReason === 'STOP') {
                    yield { kind: 'finish', reason: 'stop' };
                  } else {
                    yield {
                      kind: 'finish',
                      reason: 'error',
                      errorCode: finishReason,
                    };
                  }
                  finished = true;
                  break;
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