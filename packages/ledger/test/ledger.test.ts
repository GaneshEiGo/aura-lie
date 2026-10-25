import { describe, it, expect } from 'vitest';
import { ClaimLedger } from '../src/engine.js';

describe('Claim Ledger (FR-TRUTH-23)', () => {
  it('should record a new claim and initialize history', () => {
    const ledger = new ClaimLedger();
    const claim = ledger.recordClaim('c1', 'The battery is 41% efficient.', 92, 'VERIFIED');

    expect(claim.score).toBe(92);
    expect(claim.history.length).toBe(1);
    expect(claim.history[0].reason).toBe('Initial verification');
    expect(ledger.getAll().length).toBe(1);
  });

  it('should update a claim score and append to history', () => {
    const ledger = new ClaimLedger();
    ledger.recordClaim('c2', 'The sky is green.', 40, 'WEAK');
    
    const updated = ledger.updateScore('c2', 85, 'SUPPORTED', 'Found new evidence');
    
    expect(updated?.score).toBe(85);
    expect(updated?.status).toBe('SUPPORTED');
    expect(updated?.history.length).toBe(2);
    expect(updated?.history[1].reason).toBe('Found new evidence');
  });

  it('should search claims by text', () => {
    const ledger = new ClaimLedger();
    ledger.recordClaim('c3', 'Solid state batteries are efficient.', 90, 'VERIFIED');
    ledger.recordClaim('c4', 'The weather is sunny.', 80, 'SUPPORTED');

    const results = ledger.search('batteries');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('c3');
  });

  it('should handle claims with no score (RECALL_ONLY)', () => {
    const ledger = new ClaimLedger();
    const claim = ledger.recordClaim('c5', 'Unknown fact.', null, 'RECALL_ONLY');
    
    expect(claim.score).toBeNull();
    expect(claim.history.length).toBe(0); // No history if never scored
  });
});