import type { MemoryCandidate, MemoryRecord } from './types.js';

/**
 * PRD Section 9.5: Memory Curator
 * Pipeline: candidates > importance test > duplicate test > privacy test > expiry test > store / ask / discard
 */
export class MemoryCurator {
  public process(
    candidate: MemoryCandidate, 
    existingMemories: MemoryRecord[] = []
  ): { action: 'store' | 'ask' | 'discard' | 'merge', record?: MemoryRecord, reason: string } {
    
    // 1. Importance Test (Chit-chat is discarded)
    if (candidate.importance < 2) {
      return { action: 'discard', reason: 'Low importance (chit-chat)' };
    }

    // 2. Privacy Test (S2 needs explicit approval)
    if (candidate.sensitivity === 'S2' && !candidate.isExplicit) {
      return { action: 'ask', reason: 'S2 content requires explicit approval' };
    }

    // 3. Duplicate Test (Mocking vector cosine similarity with exact match for test stability)
    const exactMatch = existingMemories.find(m => m.text === candidate.text);
    if (exactMatch) {
      return { action: 'merge', record: exactMatch, reason: 'Duplicate found' };
    }

    // 4. Expiry Assignment (PRD 9.2)
    let expiresAt: number | undefined;
    const now = Date.now();
    
    // If it's a temporal fact, assign a review date. Otherwise, keep indefinitely (until changed/forgotten).
    if (candidate.origin === 'USER' && candidate.text.toLowerCase().includes('status')) {
      expiresAt = now + 14 * 24 * 60 * 60 * 1000; // 14 days
    } else if (candidate.origin === 'USER' || candidate.origin === 'FILE') {
      expiresAt = now + 180 * 24 * 60 * 60 * 1000; // 180 days default for episodic
    }

    const record: MemoryRecord = {
      ...candidate,
      id: crypto.randomUUID(),
      createdAt: now,
      expiresAt,
      status: 'active'
    };

    return { action: 'store', record, reason: 'Passed all tests' };
  }
}