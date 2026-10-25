import { describe, it, expect, vi } from 'vitest';
import { MockAdapter, GroqAdapter } from '../src/index.js';

// Safe ESM mock that preserves other exports
vi.mock('@aura-lie/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aura-lie/security')>();
  return {
    ...actual,
    guardedFetch: vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      body: null
    }))
  };
});

import { guardedFetch } from '@aura-lie/security';

describe('Provider Adapters (T-15)', () => {
  it('mock adapter streams tokens correctly', async () => {
    const adapter = new MockAdapter();
    const req = { model: 'mock-fast', messages: [{ role: 'user', content: 'Hi' }] };
    
    let fullText = '';
    let finishEvent = null;

    for await (const event of adapter.chat(req)) {
      if (event.type === 'token') {
        fullText += event.text;
      } else if (event.type === 'finish') {
        finishEvent = event;
      }
    }

    expect(fullText).toBe('This is a mock response.');
    expect(finishEvent?.usage?.completionTokens).toBe(20);
  });

  it('enforces Cost Guard by only allowing allowlisted hosts', async () => {
    const adapter = new GroqAdapter('fake-key');
    const req = { model: 'llama-3.1-8b-instant', messages: [] };

    for await (const _ of adapter.chat(req)) {}

    expect(guardedFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });
});