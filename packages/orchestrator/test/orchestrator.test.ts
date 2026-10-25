import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import type { ChatEvent } from '../src/events.js';

describe('Orchestrator Lifecycle (PRD 7.2)', () => {
  const orchestrator = new Orchestrator();

  it('should stream meta, tokens, verification, and done events for a factual query', async () => {
    const req = { message: "What is the latest efficiency of the new battery?", mode: "instant" as const, persona: "Aura-lie", thinking: true };
    const events: ChatEvent[] = [];

    for await (const event of orchestrator.execute(req)) {
      events.push(event);
    }

    const types = events.map(e => e.t);
    
    expect(types).toContain('meta');
    expect(types).toContain('trace');
    expect(types).toContain('token');
    expect(types).toContain('claim');
    expect(types).toContain('source');
    expect(types).toContain('quote');
    expect(types).toContain('score');
    expect(types).toContain('summary');
    expect(types[types.length - 1]).toBe('done');

    const meta = events.find(e => e.t === 'meta') as any;
    expect(meta.riskTier).toBe(2); 
    expect(meta.mode).toBe('instant');

    const quote = events.find(e => e.t === 'quote') as any;
    expect(quote.matchOk).toBe(true); 
    
    const done = events.find(e => e.t === 'done') as any;
    expect(done.costInr).toBe(0);
  });

  it('should skip verification for casual chat', async () => {
    const req = { message: "Hello!", mode: "instant" as const, persona: "Aura-lie", thinking: false };
    const events: ChatEvent[] = [];

    for await (const event of orchestrator.execute(req)) {
      events.push(event);
    }

    const types = events.map(e => e.t);
    expect(types).toContain('meta');
    expect(types).toContain('token');
    expect(types).not.toContain('claim'); 
    expect(types).toContain('summary');
  });
});