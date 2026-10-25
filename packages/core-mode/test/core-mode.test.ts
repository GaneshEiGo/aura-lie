import { describe, it, expect, beforeEach } from 'vitest';
import { CoreModeEngine, safeCalculate, parseDateMath, BM25 } from '../src/index.js';

describe('Core Mode Resilience (T-28)', () => {
  let engine: CoreModeEngine;

  beforeEach(() => {
    engine = new CoreModeEngine();
  });

  it('calculates math safely without eval', () => {
    expect(safeCalculate('10 + 20 * 2')).toBe(50);
    expect(safeCalculate('(10 + 20) * 2')).toBe(60);
    expect(safeCalculate('10 / 0')).toBeNull();
    expect(safeCalculate('alert("hack")')).toBeNull();
  });

  it('handles date math', () => {
    const res = parseDateMath('what is the date 5 days from now?');
    expect(res).toContain('The date 5 days from now is');
  });

  it('retrieves exact answers from cache with age labels', () => {
    engine.cache.set('What is the capital of France?', 'Paris.');
    const result = engine.process('What is the capital of France?');
    
    expect(result.type).toBe('cache');
    expect(result.text).toContain('Paris.');
    expect(result.text).toContain('[cached · just now]');
  });

  it('uses rule tools when offline', () => {
    const result = engine.process('calculate 15 * 3');
    expect(result.type).toBe('tool');
    expect(result.text).toBe('The result is 45.');
  });

  it('uses BM25 memory search when offline', () => {
    engine.bm25.addDocuments([
      { id: 'm1', text: 'The user prefers minimal interfaces and dark mode.', importance: 5 },
      { id: 'm2', text: 'The server runs on Cloudflare Workers.', importance: 3 },
    ]);

    const result = engine.process('what does the user prefer?');
    expect(result.type).toBe('memory');
    expect(result.text).toContain('minimal interfaces');
  });

  it('queues a promise if all else fails', () => {
    const result = engine.process('Write a 5000 word essay on the history of Rome.');
    expect(result.type).toBe('promise');
    expect(result.text).toContain('queued your request');
    
    const pending = engine.promises.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('queued');
  });

  it('maintains 100% promise-keep rate when fulfilled', () => {
    const id = engine.promises.enqueue('Test request', Date.now() + 1000);
    engine.promises.resume(id, true);
    expect(engine.promises.getKeepRate()).toBe(100);
  });
});