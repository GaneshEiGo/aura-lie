import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../src/router.js';
import type { ModelAdapter } from '../src/types.js';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('Model Router (PRD 7.4)', () => {
  const mockRegistry: ModelAdapter[] = [
    { id: 'groq-70b', provider: 'groq', lane: 'private', roles: ['reasoner', 'chat_fast'], contextWindow: 8000, health: 0.9, costPer1kTokens: 0 },
    { id: 'gemini-flash', provider: 'google', lane: 'training-risk', roles: ['reasoner', 'chat_fast', 'vision'], contextWindow: 32000, health: 0.95, costPer1kTokens: 0 },
    { id: 'workers-ai', provider: 'cloudflare', lane: 'private', roles: ['utility', 'embed'], contextWindow: 4096, health: 0.99, costPer1kTokens: 0 }
  ];

  it('should select the best model based on health', () => {
    const router = new ModelRouter(mockRegistry);
    const result = router.select({ role: 'reasoner', sensitivity: 'S0', promptLength: 1000 });
    
    // Gemini has higher health, but is training-risk. For S0, it should win.
    expect(result.model.id).toBe('gemini-flash');
  });

  it('should restrict S2 data to the private lane', () => {
    const router = new ModelRouter(mockRegistry);
    const result = router.select({ role: 'reasoner', sensitivity: 'S2', promptLength: 1000 });
    
    // Gemini is training-risk, so Groq (private) must be chosen.
    expect(result.model.id).toBe('groq-70b');
    expect(result.model.lane).toBe('private');
  });

  it('should enforce the 60% context window rule', () => {
    const router = new ModelRouter(mockRegistry);
    // Prompt is 5000 tokens. Groq 8000 * 0.6 = 4800 (fails). Gemini 32000 * 0.6 = 19200 (passes).
    const result = router.select({ role: 'reasoner', sensitivity: 'S0', promptLength: 5000 });
    expect(result.model.id).toBe('gemini-flash');
  });

  it('should prioritize diversity for judges (different provider)', () => {
    const router = new ModelRouter(mockRegistry);
    // Groq is health 0.9, Gemini is 0.95. Gemini usually wins. But we want diversity.
    const result = router.select({ role: 'reasoner', sensitivity: 'S0', promptLength: 1000, preferDiversity: true });
    
    // It should pick Groq because it's a different provider from the presumed primary (Gemini)
    expect(result.model.provider).not.toBe('google');
    expect(result.reason).toContain('Diversity requested');
  });

  it('circuit breaker should open after failures and block routing', () => {
    const cb = new CircuitBreaker();
    expect(cb.isAvailable()).toBe(true);
    
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    
    expect(cb.isAvailable()).toBe(false);
  });
});