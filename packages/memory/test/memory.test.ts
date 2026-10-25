import { describe, it, expect } from 'vitest';
import { MemoryCurator } from '../src/curator.js';
import type { MemoryCandidate } from '../src/types.js';

describe('Memory Curator (PRD 9.5)', () => {
  const curator = new MemoryCurator();
  
  const baseCandidate: MemoryCandidate = {
    text: "Prefers minimal interfaces",
    origin: "USER",
    sensitivity: "S0",
    importance: 4,
    sourceMessageId: "msg-1"
  };

  it('should discard low importance', () => {
    const result = curator.process({ ...baseCandidate, importance: 1 });
    expect(result.action).toBe('discard');
    expect(result.reason).toContain('Low importance');
  });

  it('should ask for S2 privacy approval', () => {
    const result = curator.process({ ...baseCandidate, sensitivity: 'S2' });
    expect(result.action).toBe('ask');
    expect(result.reason).toContain('S2 content requires');
  });

  it('should allow S2 if user was explicit', () => {
    const result = curator.process({ ...baseCandidate, sensitivity: 'S2', isExplicit: true });
    expect(result.action).toBe('store');
  });

  it('should merge duplicates', () => {
    const existing = [{ 
      ...baseCandidate, 
      id: 'mem-1', 
      createdAt: Date.now(), 
      status: 'active' as const 
    }];
    const result = curator.process(baseCandidate, existing);
    expect(result.action).toBe('merge');
    expect(result.record?.id).toBe('mem-1');
  });

  it('should store valid memories and assign appropriate expiry', () => {
    const result = curator.process(baseCandidate);
    expect(result.action).toBe('store');
    expect(result.record).toBeDefined();
    expect(result.record?.status).toBe('active');
    expect(result.record?.expiresAt).toBeGreaterThan(Date.now());
  });
});