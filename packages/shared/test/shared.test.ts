import { describe, it, expect } from 'vitest';
import { ChatEventSchema, TraceEventSchema, ClaimEventSchema, MemoryRecordSchema } from '../src/index.js';

describe('Shared Schemas (Event Bus)', () => {
  it('validates a Trace Event exactly as the UI expects', () => {
    const trace = {
      t: '0.0s',
      type: 'plan',
      msg: 'intent=query · mode=Instant · risk=R1 · freshness=volatile'
    };
    expect(() => TraceEventSchema.parse(trace)).not.toThrow();
  });

  it('validates a Claim Event with factors and sources', () => {
    const claim = {
      id: 'c1',
      text: 'The 70B daily cap is ~1,000/day.',
      kind: 'fact',
      importance: 0.8,
      score: 85,
      status: 'VERIFIED',
      band: 'verified',
      glyph: '+',
      factors: [{ label: 'Grounding', value: 0.9 }],
      sources: [{ tier: 1, domain: 'api.groq.com', title: 'Groq Limits', date: '2026-10-02' }],
      contradictions: [],
      strengthen: 'A second source would help.'
    };
    expect(() => ClaimEventSchema.parse(claim)).not.toThrow();
  });

  it('validates a full ChatEvent SSE stream meta tag', () => {
    const meta = {
      t: 'meta',
      turnId: '123',
      mode: 'Instant',
      persona: 'AURA_LIE',
      lane: 'private',
      sensitivity: 'S0'
    };
    expect(() => ChatEventSchema.parse(meta)).not.toThrow();
  });

  it('validates Memory Records', () => {
    const mem = {
      id: 'm1',
      type: 'semantic',
      text: 'Prefers minimal interfaces.',
      origin: 'USER',
      created: new Date().toISOString(),
      meta: ['source: user-stated'],
      inferred: false
    };
    expect(() => MemoryRecordSchema.parse(mem)).not.toThrow();
  });
});