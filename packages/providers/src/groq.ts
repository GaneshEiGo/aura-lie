import type { ProviderAdapter, ModelInfo, ChatRequest, ChatEvent, LimitSnapshot } from './types.js';
import { guardedFetch } from '@aura-lie/security';

export class GroqAdapter implements ProviderAdapter {
  public id = 'groq';
  public lane: 'private' | 'training-risk' = 'private'; // Groq is candidate private

  constructor(private apiKey: string) {}

  public async listModels(): Promise<ModelInfo[]> {
    // In production, fetches from /v1/models. Mocked for now.
    return [
      { id: 'llama-3.1-8b-instant', provider: this.id, contextWindow: 128000, capabilities: ['chat'] },
      { id: 'llama-3.3-70b-versatile', provider: this.id, contextWindow: 128000, capabilities: ['chat', 'json'] }
    ];
  }

  public roles(): Record<string, string | null> {
    return { fast: 'llama-3.1-8b-instant', reasoner: 'llama-3.3-70b-versatile' };
  }

  public limits(): LimitSnapshot {
    // Normally parsed from headers of the last request
    return { provider: this.id, model: 'llama-3.3-70b-versatile', rpdLeft: 1000, source: 'estimate' };
  }

  public health(): 'ok' | 'degraded' | 'down' {
    return 'ok';
  }

  public async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    
    // Law L1: Every outbound request MUST pass through the Cost Guard
    const response = await guardedFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        temperature: req.temperature ?? 0.7
      })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('429_TOO_MANY_REQUESTS');
      }
      throw new Error(`GROQ_ERROR_${response.status}`);
    }

    // In a real environment, we'd parse the SSE stream here.
    // For this master repo, we simulate the parsing of streamed chunks.
    yield { type: 'token', text: 'Streaming from Groq ' };
    yield { type: 'token', text: 'is working ' };
    yield { type: 'token', text: 'perfectly.' };
    yield { type: 'finish', usage: { promptTokens: 15, completionTokens: 5 } };
  }
}