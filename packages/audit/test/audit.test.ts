import { describe, it, expect } from 'vitest';
import { AuditLogger } from '../src/logger.js';

describe('Audit Log (PRD 10.10, L7)', () => {
  it('should create a hash-chained log entry', () => {
    const logger = new AuditLogger();
    const entry1 = logger.log('AURA-LIE', 'search', 'User asked a question', 'search_tool', 'hash123', 'Found 3 results', 'success');
    
    expect(entry1.id).toBeDefined();
    expect(entry1.prevHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(entry1.hash).not.toBe(entry1.prevHash);
  });

  it('should link entries correctly', () => {
    const logger = new AuditLogger();
    const entry1 = logger.log('AURA-LIE', 'search', 'Reason 1', 'tool1', 'hash1', 'out1', 'success');
    const entry2 = logger.log('AURA-LIE', 'fetch', 'Reason 2', 'tool2', 'hash2', 'out2', 'success');
    
    expect(entry2.prevHash).toBe(entry1.hash);
  });

  it('should verify an unbroken chain', () => {
    const logger = new AuditLogger();
    logger.log('AURA-LIE', 'search', 'Reason 1', 'tool1', 'hash1', 'out1', 'success');
    logger.log('AURA-LIE', 'fetch', 'Reason 2', 'tool2', 'hash2', 'out2', 'success');
    logger.log('AURA-LIE', 'calc', 'Reason 3', 'tool3', 'hash3', 'out3', 'success');

    expect(logger.verifyChain()).toBe(true);
  });

  it('should detect a tampered entry', () => {
    const logger = new AuditLogger();
    logger.log('AURA-LIE', 'search', 'Reason 1', 'tool1', 'hash1', 'out1', 'success');
    logger.log('AURA-LIE', 'fetch', 'Reason 2', 'tool2', 'hash2', 'out2', 'success');

    // Tamper with the first entry
    const entries = logger.getEntries() as any[];
    entries[0].reason = 'Tampered reason';

    expect(logger.verifyChain()).toBe(false);
  });
});