import { describe, it, expect } from 'vitest';
import { AuraLieLoop } from '../src/index.js';
import { MockAdapter } from '@aura-lie/providers';
import type { ModelInfo } from '@aura-lie/router';
import type { ChatEvent } from '@aura-lie/shared';

describe('Aura-lie Core Loop', () => {
  const models: ModelInfo[] = [
    { id: 'mock-fast', provider: 'mock-provider', family: 'mock', lane: 'private', contextWindow: 8000, capabilities: ['chat'], costInr: 0 }
  ];

  it('streams tokens and finishes successfully', async () => {
    const adapter = new MockAdapter();
    const loop = new AuraLieLoop(models, [adapter]);

    const events: ChatEvent[] = [];
    for await (const event of loop.processMessage({
      query: 'Hello, how are you?',
      mode: 'Instant',
      userId: 'user-1',
      sessionId: 'session-1'
    })) {
      events.push(event);
    }

    const meta = events.find(e => e.t === 'meta');
    expect(meta).toBeDefined();
    
    const tokens = events.filter(e => e.t === 'token').map(e => (e as any).delta).join('');
    expect(tokens).toBe('This is a mock response.');

    const done = events.find(e => e.t === 'done');
    expect(done).toBeDefined();
    expect((done as any).costInr).toBe(0);
  });

  it('blocks S2 sensitive data from going to training-risk lanes', async () => {
    const riskyModels: ModelInfo[] = [
      { id: 'risky-model', provider: 'mock-risky', family: 'mock', lane: 'training-risk', contextWindow: 8000, capabilities: ['chat'], costInr: 0 }
    ];
    const adapter = new MockAdapter();
    const loop = new AuraLieLoop(riskyModels, [adapter]);

    const events: ChatEvent[] = [];
    for await (const event of loop.processMessage({
      query: 'My password is 12345, write it down.',
      mode: 'Instant',
      userId: 'user-1',
      sessionId: 'session-1'
    })) {
      events.push(event);
    }

    const error = events.find(e => e.t === 'error');
    expect(error).toBeDefined();
    expect(error?.t).toBe('error');
    expect((error as any).code).toBe('ROUTER_FAILED');
  });
});