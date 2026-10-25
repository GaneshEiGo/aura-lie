import type { ProviderAdapter, ModelInfo, ChatRequest, ChatEvent, LimitSnapshot } from './types.js';

export class MockAdapter implements ProviderAdapter {
  public id = 'mock-provider';
  public lane: 'private' | 'training-risk' = 'private';

  public async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'mock-fast', provider: this.id, contextWindow: 8000, capabilities: ['chat'] }];
  }

  public roles(): Record<string, string | null> {
    return { fast: 'mock-fast', reasoner: null };
  }

  public limits(): LimitSnapshot {
    return { provider: this.id, model: 'mock-fast', rpdLeft: 1000, source: 'headers' };
  }

  public health(): 'ok' | 'degraded' | 'down' {
    return 'ok';
  }

  public async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    yield { type: 'token', text: 'This is ' };
    await new Promise(r => setTimeout(r, 10));
    yield { type: 'token', text: 'a mock ' };
    await new Promise(r => setTimeout(r, 10));
    yield { type: 'token', text: 'response.' };
    yield { type: 'finish', usage: { promptTokens: 10, completionTokens: 20 } };
  }
}